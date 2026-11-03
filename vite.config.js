import react from '@vitejs/plugin-react'
import nodemailer from 'nodemailer'
import { defineConfig, loadEnv } from 'vite'

function robloxApi(environment) {
  function sendJson(response, status, data) {
    response.writeHead(status)
    response.end(JSON.stringify(data))
  }

  function getUserId(requestUrl) {
    const userId = Number(requestUrl.searchParams.get('userId'))
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null
  }

  const feedbackRequests = new Map()

  async function handleFeedback(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      sendJson(response, 405, { error: 'Method not allowed.' })
      return
    }

    const requestIp = request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const attempts = (feedbackRequests.get(requestIp) || []).filter(
      (timestamp) => now - timestamp < 10 * 60 * 1000,
    )
    if (attempts.length >= 3) {
      feedbackRequests.set(requestIp, attempts)
      sendJson(response, 429, { error: 'Please wait a few minutes before sending more feedback.' })
      return
    }

    if (!environment.SMTP_USER || !environment.SMTP_PASS) {
      sendJson(response, 503, {
        error: 'Email sending is not configured. Set SMTP_USER and SMTP_PASS in the project-root .env file, then restart the server.',
      })
      return
    }

    const contentType = request.headers['content-type'] || ''
    if (!contentType.toLowerCase().includes('application/json')) {
      sendJson(response, 415, { error: 'Feedback must be submitted as JSON.' })
      return
    }

    let payload
    try {
      payload = await new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        let settled = false
        request.on('data', (chunk) => {
          size += chunk.length
          if (size > 10000) {
            settled = true
            reject(new Error('Feedback is too large.'))
            request.resume()
          } else if (!settled) {
            chunks.push(chunk)
          }
        })
        request.on('end', () => {
          if (settled) return
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error('Feedback request must contain valid JSON.'))
          }
        })
        request.on('error', reject)
      })
    } catch (error) {
      sendJson(response, error.message === 'Feedback is too large.' ? 413 : 400, { error: error.message })
      return
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJson(response, 400, { error: 'Feedback request must be a JSON object.' })
      return
    }

    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    const message = typeof payload.message === 'string' ? payload.message.trim() : ''
    if (name.length > 100 || !message || message.length > 5000) {
      sendJson(response, 400, { error: 'Enter a message (up to 5,000 characters) and a name under 100 characters.' })
      return
    }
    attempts.push(now)
    feedbackRequests.set(requestIp, attempts)
    const port = Number(environment.SMTP_PORT || 465)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      sendJson(response, 503, { error: 'Feedback email server configuration is invalid.' })
      return
    }

    try {
      const transporter = nodemailer.createTransport({
        host: environment.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS },
      })
      await transporter.sendMail({
        from: environment.SMTP_USER,
        to: 'avakinyuro@gmail.com',
        subject: 'Blockscope feedback request',
        text: [
          `Name: ${name || 'Not provided'}`,
          '',
          message,
        ].join('\n'),
      })
      sendJson(response, 200, { message: 'Your feedback was sent to the site owner.' })
    } catch (error) {
      console.error('Feedback email could not be sent:', error)
      sendJson(response, 502, { error: 'Could not send feedback right now. Please try again later.' })
    }
  }

  async function lookupPresence(userId, signal) {
    const presenceResponse = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] }),
      signal,
    })
    if (!presenceResponse.ok) {
      throw new Error(`Roblox presence lookup failed (${presenceResponse.status}).`)
    }

    const presenceData = await presenceResponse.json()
    const userPresence = presenceData.userPresences?.[0]
    const statusByType = {
      0: 'offline',
      1: 'online',
      2: 'in-experience',
      3: 'in-studio',
    }
    const presence = {
      status: statusByType[userPresence?.userPresenceType] ?? 'unavailable',
      lastLocation: userPresence?.lastLocation || '',
      universeId: userPresence?.universeId ?? null,
    }

    if (presence.status === 'in-experience' && presence.universeId) {
      const gameResponse = await fetch(
        `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(presence.universeId)}`,
        { signal },
      )
      if (gameResponse.ok) {
        const gameData = await gameResponse.json()
        presence.experienceName = gameData.data?.[0]?.name ?? ''
      } else {
        console.error(`Roblox experience lookup failed (${gameResponse.status}).`)
      }
    }

    return presence
  }

  async function handleProfileLookup(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      response.writeHead(405)
      response.end(JSON.stringify({ error: 'Method not allowed.' }))
      return
    }

    const requestUrl = new URL(request.url, 'http://localhost')
    const username = requestUrl.searchParams.get('username')?.trim()
    if (!username || username.length > 20) {
      response.writeHead(400)
      response.end(JSON.stringify({ error: 'Enter a Roblox username of 1 to 20 characters.' }))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      const lookupResponse = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
        signal: controller.signal,
      })

      if (!lookupResponse.ok) {
        response.writeHead(lookupResponse.status)
        response.end(JSON.stringify({ error: `Roblox username lookup failed (${lookupResponse.status}).` }))
        return
      }

      const lookup = await lookupResponse.json()
      const user = lookup.data?.[0]
      if (!user?.id) {
        sendJson(response, 404, { error: `No Roblox user found for "${username}".` })
        return
      }

      const [detailsResult, avatarResult, presenceResult] = await Promise.allSettled([
        fetch(`https://users.roblox.com/v1/users/${user.id}`, { signal: controller.signal }),
        fetch(
          `https://thumbnails.roblox.com/v1/users/avatar?userIds=${user.id}&size=420x420&format=Png&isCircular=false`,
          { signal: controller.signal },
        ),
        lookupPresence(user.id, controller.signal),
      ])
      if (detailsResult.status === 'rejected') throw detailsResult.reason
      if (avatarResult.status === 'rejected') throw avatarResult.reason
      const detailsResponse = detailsResult.value
      const avatarResponse = avatarResult.value
      if (!detailsResponse.ok || !avatarResponse.ok) {
        const status = !detailsResponse.ok ? detailsResponse.status : avatarResponse.status
        sendJson(response, status, { error: `Roblox profile lookup failed (${status}).` })
        return
      }

      const [details, avatar] = await Promise.all([
        detailsResponse.json(),
        avatarResponse.json(),
      ])

      let presence = { status: 'unavailable' }
      if (presenceResult.status === 'fulfilled') {
        presence = presenceResult.value
      } else {
        console.error('Roblox presence lookup failed:', presenceResult.reason)
      }

      sendJson(response, 200, {
        id: details.id,
        name: details.name,
        displayName: details.displayName,
        description: details.description,
        created: details.created,
        avatarUrl: avatar.data?.[0]?.imageUrl ?? '',
        presence,
      })
    } catch (error) {
      const timedOut = error.name === 'AbortError'
      console.error('Roblox public profile API request failed:', error)
      sendJson(response, 502, {
        error: timedOut
          ? 'Roblox took too long to respond. Please try again.'
          : 'Could not reach Roblox. Check your connection and try again.',
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function handlePresenceLookup(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed.' })
      return
    }

    const userId = getUserId(new URL(request.url, 'http://localhost'))
    if (!userId) {
      sendJson(response, 400, { error: 'A valid Roblox user ID is required.' })
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const presence = await lookupPresence(userId, controller.signal)
      sendJson(response, 200, { presence })
    } catch (error) {
      const timedOut = error.name === 'AbortError'
      console.error('Roblox live presence API request failed:', error)
      sendJson(response, 502, {
        error: timedOut
          ? 'Roblox took too long to respond. Please try again.'
          : error.message,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function handleFriendsLookup(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed.' })
      return
    }

    const requestUrl = new URL(request.url, 'http://localhost')
    const userId = getUserId(requestUrl)
    if (!userId) {
      sendJson(response, 400, { error: 'A valid Roblox user ID is required.' })
      return
    }

    const cursor = requestUrl.searchParams.get('cursor') ?? ''
    if (cursor.length > 512) {
      sendJson(response, 400, { error: 'Invalid friends list cursor.' })
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const friendsUrl = new URL(`https://friends.roblox.com/v1/users/${userId}/friends`)
      friendsUrl.searchParams.set('limit', '20')
      friendsUrl.searchParams.set('sortOrder', 'Asc')
      if (cursor) friendsUrl.searchParams.set('cursor', cursor)

      const friendsResponse = await fetch(friendsUrl, { signal: controller.signal })
      if (!friendsResponse.ok) {
        sendJson(response, friendsResponse.status, {
          error: friendsResponse.status === 403
            ? "Roblox doesn't make this user's friends list available."
            : `Roblox friends lookup failed (${friendsResponse.status}).`,
        })
        return
      }

      const friendsData = await friendsResponse.json()
      const friends = Array.isArray(friendsData.data) ? friendsData.data : []
      const userIds = friends.map((friend) => friend.id).filter(Number.isSafeInteger)
      let avatars = new Map()

      if (userIds.length > 0) {
        const avatarResponse = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userIds.join(',')}&size=150x150&format=Png&isCircular=false`,
          { signal: controller.signal },
        )
        if (avatarResponse.ok) {
          const avatarData = await avatarResponse.json()
          const avatarItems = Array.isArray(avatarData.data) ? avatarData.data : []
          avatars = new Map(avatarItems.map((avatar) => [avatar.targetId, avatar.imageUrl]))
        } else {
          console.error(`Roblox friends avatar lookup failed (${avatarResponse.status}).`)
        }
      }

      sendJson(response, 200, {
        data: friends.map((friend) => ({
          id: friend.id,
          name: friend.name,
          displayName: friend.displayName,
          avatarUrl: avatars.get(friend.id) ?? '',
        })),
        nextPageCursor: friendsData.nextPageCursor ?? null,
      })
    } catch (error) {
      const timedOut = error.name === 'AbortError'
      console.error('Roblox public friends API request failed:', error)
      sendJson(response, 502, {
        error: timedOut
          ? 'Roblox took too long to respond. Please try again.'
          : 'Could not reach Roblox. Check your connection and try again.',
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function handleFriendsCountLookup(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed.' })
      return
    }

    const userId = getUserId(new URL(request.url, 'http://localhost'))
    if (!userId) {
      sendJson(response, 400, { error: 'A valid Roblox user ID is required.' })
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const countResponse = await fetch(
        `https://friends.roblox.com/v1/users/${userId}/friends/count`,
        { signal: controller.signal },
      )
      if (!countResponse.ok) {
        sendJson(response, countResponse.status, {
          error: `Roblox friends count lookup failed (${countResponse.status}).`,
        })
        return
      }

      const countData = await countResponse.json()
      if (!Number.isSafeInteger(countData.count) || countData.count < 0) {
        sendJson(response, 502, { error: 'Roblox returned an invalid friends count.' })
        return
      }

      sendJson(response, 200, { count: countData.count })
    } catch (error) {
      const timedOut = error.name === 'AbortError'
      console.error('Roblox public friends count API request failed:', error)
      sendJson(response, 502, {
        error: timedOut
          ? 'Roblox took too long to respond. Please try again.'
          : 'Could not reach Roblox. Check your connection and try again.',
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  function install(middlewares) {
    middlewares.use('/api/feedback', handleFeedback)
    middlewares.use('/api/roblox/profile', handleProfileLookup)
    middlewares.use('/api/roblox/presence', handlePresenceLookup)
    middlewares.use('/api/roblox/friends/count', handleFriendsCountLookup)
    middlewares.use('/api/roblox/friends', handleFriendsLookup)
  }

  return {
    name: 'roblox-public-profile-api',
    configureServer(server) {
      install(server.middlewares)
    },
    configurePreviewServer(server) {
      install(server.middlewares)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), robloxApi(loadEnv(mode, process.cwd(), ''))],
}))
