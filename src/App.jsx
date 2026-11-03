import { useEffect, useRef, useState } from 'react'
import './App.css'

const BOOKMARKS_KEY = 'blockscope.bookmarks'

function getInitialBookmarks() {
  try {
    const saved = localStorage.getItem(BOOKMARKS_KEY)
    if (!saved) return { items: [], error: '' }

    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) throw new Error('Saved bookmarks are not in a valid format.')
    return {
      items: parsed.filter((item) => Number.isSafeInteger(item.id) && item.name),
      error: '',
    }
  } catch (storageError) {
    return { items: [], error: `Could not load saved bookmarks: ${storageError.message}` }
  }
}

function App() {
  const [username, setUsername] = useState('')
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [{ items: bookmarks, error: bookmarkError }, setBookmarkState] = useState(getInitialBookmarks)
  const [showFriends, setShowFriends] = useState(false)
  const [friends, setFriends] = useState([])
  const [friendsCursor, setFriendsCursor] = useState(null)
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsError, setFriendsError] = useState('')
  const [friendCount, setFriendCount] = useState(null)
  const [friendCountLoading, setFriendCountLoading] = useState(false)
  const [friendCountError, setFriendCountError] = useState('')
  const [livePresence, setLivePresence] = useState(null)
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState(null)
  const [presenceError, setPresenceError] = useState('')
  const [feedbackName, setFeedbackName] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const activeRequest = useRef(null)
  const friendsRequest = useRef(null)
  const friendsCountRequest = useRef(null)

  async function loadProfile(searchTerm) {
    if (!searchTerm) {
      setError('Enter a Roblox username to search.')
      setProfile(null)
      return
    }

    activeRequest.current?.abort()
    friendsRequest.current?.abort()
    friendsCountRequest.current?.abort()
    friendsRequest.current = null
    friendsCountRequest.current = null
    const controller = new AbortController()
    activeRequest.current = controller
    setIsLoading(true)
    setError('')
    setProfile(null)
    setFriends([])
    setFriendsCursor(null)
    setFriendsLoaded(false)
    setFriendsLoading(false)
    setFriendsError('')
    setFriendCount(null)
    setFriendCountLoading(false)
    setFriendCountError('')
    setLivePresence(null)
    setPresenceUpdatedAt(null)
    setPresenceError('')
    setShowFriends(false)

    try {
      const response = await fetch(
        `/api/roblox/profile?username=${encodeURIComponent(searchTerm)}`,
        { signal: controller.signal },
      )
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `Profile lookup failed (${response.status}).`)
      }

      setProfile(result)
      setLivePresence(result.presence ?? null)
      setPresenceUpdatedAt(new Date())
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(
          requestError instanceof TypeError
            ? 'Could not reach Roblox right now. Check your connection and try again.'
            : requestError.message,
        )
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setIsLoading(false)
      }
    }
  }

  function searchProfile(event) {
    event.preventDefault()
    void loadProfile(username.trim())
  }

  async function submitFeedback(event) {
    event.preventDefault()
    setFeedbackLoading(true)
    setFeedbackStatus('')
    setFeedbackError('')

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: feedbackName,
          message: feedbackMessage,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || `Feedback request failed (${response.status}).`)
      }

      setFeedbackStatus(result.message || 'Your feedback was sent.')
      setFeedbackName('')
      setFeedbackMessage('')
    } catch (requestError) {
      setFeedbackError(requestError instanceof TypeError
        ? 'Could not reach the feedback service. Check your connection and try again.'
        : requestError.message)
    } finally {
      setFeedbackLoading(false)
    }
  }

  function toggleBookmark() {
    if (!profile) return

    const isSaved = bookmarks.some((item) => item.id === profile.id)
    const nextBookmarks = isSaved
      ? bookmarks.filter((item) => item.id !== profile.id)
      : [{
          id: profile.id,
          name: profile.name,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        }, ...bookmarks]

    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(nextBookmarks))
      setBookmarkState({ items: nextBookmarks, error: '' })
    } catch (storageError) {
      setBookmarkState({ items: bookmarks, error: `Could not save bookmark: ${storageError.message}` })
    }
  }

  function removeBookmark(userId) {
    const nextBookmarks = bookmarks.filter((item) => item.id !== userId)
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(nextBookmarks))
      setBookmarkState({ items: nextBookmarks, error: '' })
    } catch (storageError) {
      setBookmarkState({ items: bookmarks, error: `Could not update saved bookmarks: ${storageError.message}` })
    }
  }

  async function loadFriends(userId, cursor = null, append = false) {
    friendsRequest.current?.abort()
    const controller = new AbortController()
    friendsRequest.current = controller
    setFriendsLoading(true)
    setFriendsError('')

    try {
      const query = new URLSearchParams({ userId: String(userId) })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch(`/api/roblox/friends?${query}`, { signal: controller.signal })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `Friends lookup failed (${response.status}).`)
      }

      setFriends((current) => append ? [...current, ...result.data] : result.data)
      setFriendsCursor(result.nextPageCursor)
      setFriendsLoaded(true)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setFriendsError(requestError instanceof TypeError
          ? 'Could not reach Roblox right now. Check your connection and try again.'
          : requestError.message)
        setFriendsLoaded(true)
      }
    } finally {
      if (friendsRequest.current === controller) {
        friendsRequest.current = null
        setFriendsLoading(false)
      }
    }
  }

  async function loadFriendsCount(userId) {
    friendsCountRequest.current?.abort()
    const controller = new AbortController()
    friendsCountRequest.current = controller
    setFriendCountLoading(true)
    setFriendCountError('')

    try {
      const query = new URLSearchParams({ userId: String(userId) })
      const response = await fetch(`/api/roblox/friends/count?${query}`, { signal: controller.signal })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `Friends count lookup failed (${response.status}).`)
      }
      if (!Number.isSafeInteger(result.count) || result.count < 0) {
        throw new Error('Roblox returned an invalid friends count.')
      }

      setFriendCount(result.count)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setFriendCountError(requestError instanceof TypeError
          ? 'Could not reach Roblox right now. Check your connection and try again.'
          : requestError.message)
      }
    } finally {
      if (friendsCountRequest.current === controller) {
        friendsCountRequest.current = null
        setFriendCountLoading(false)
      }
    }
  }

  function toggleFriends() {
    const nextShowFriends = !showFriends
    setShowFriends(nextShowFriends)
    if (nextShowFriends && !friendsLoaded && !friendsLoading) {
      void loadFriends(profile.id)
    }
    if (nextShowFriends && friendCount === null && !friendCountLoading) {
      void loadFriendsCount(profile.id)
    }
  }

  useEffect(() => {
    if (!profile?.id) return undefined

    let active = true
    let inFlight = false
    let controller

    async function refreshPresence() {
      if (inFlight) return
      inFlight = true
      controller = new AbortController()

      try {
        const query = new URLSearchParams({ userId: String(profile.id) })
        const response = await fetch(`/api/roblox/presence?${query}`, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || `Presence lookup failed (${response.status}).`)
        }

        if (active) {
          setLivePresence(result.presence)
          setPresenceUpdatedAt(new Date())
          setPresenceError('')
        }
      } catch (requestError) {
        if (active && requestError.name !== 'AbortError') {
          setPresenceError(requestError instanceof TypeError
            ? 'Could not refresh public status. Check your connection.'
            : requestError.message)
        }
      } finally {
        inFlight = false
      }
    }

    void refreshPresence()
    const intervalId = window.setInterval(() => void refreshPresence(), 30000)
    return () => {
      active = false
      window.clearInterval(intervalId)
      controller?.abort()
    }
  }, [profile?.id])

  const createdDate = profile?.created
    ? new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(profile.created))
    : 'Not available'
  const isBookmarked = profile && bookmarks.some((item) => item.id === profile.id)
  const presenceLabels = {
    offline: 'Offline',
    online: 'Online',
    'in-experience': 'In an experience',
    'in-studio': 'In Roblox Studio',
    unavailable: 'Status unavailable',
  }
  const currentPresence = livePresence ?? profile?.presence
  const presenceStatus = currentPresence?.status ?? 'unavailable'

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Blockscope home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 7h18v18H7z" stroke="currentColor" strokeWidth="3" />
              <path d="m12 20 4-8 4 8m-6.5-3h5" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </span>
          <span>blockscope</span>
        </a>
        <span className="topbar-note"><span className="status-dot" /> Public profile explorer</span>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> ROBLOX PLAYER LOOKUP</div>
        <h1>Find a player.<br /><span>See their public profile.</span></h1>
        <p className="hero-copy">
          Look up public Roblox account details using a username. No sign-in needed.
        </p>

        <form className="search-form" onSubmit={searchProfile}>
          <label className="sr-only" htmlFor="username">Roblox username</label>
          <span className="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <input
            id="username"
            autoComplete="off"
            maxLength={20}
            placeholder="Enter a Roblox username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search profile'}
            {!isLoading && <span aria-hidden="true">↗</span>}
          </button>
        </form>

        <p className="privacy-note">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 2.5 16 5v4.1c0 3.8-2.6 6.7-6 8.4-3.4-1.7-6-4.6-6-8.4V5l6-2.5Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="m7.5 9.8 1.7 1.7 3.5-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Public information only. Passwords are private and are never requested or shown.
        </p>
      </section>

      {error && (
        <div className="feedback error" role="alert">
          <span className="feedback-icon" aria-hidden="true">!</span>
          {error}
        </div>
      )}

      {bookmarks.length > 0 && (
        <section className="bookmarks-panel" aria-label="Saved profiles">
          <div className="bookmarks-heading">
            <div>
              <p className="section-eyebrow">YOUR LIST</p>
              <h2>Saved profiles <span>{bookmarks.length}</span></h2>
            </div>
            <span className="local-note">Saved on this device</span>
          </div>
          <div className="bookmark-list">
            {bookmarks.map((bookmark) => (
              <div className="bookmark-row" key={bookmark.id}>
                <button
                  type="button"
                  className="bookmark-open"
                  onClick={() => {
                    setUsername(bookmark.name)
                    void loadProfile(bookmark.name)
                  }}
                >
                  {bookmark.avatarUrl
                    ? <img src={bookmark.avatarUrl} alt="" />
                    : <span className="bookmark-placeholder">{bookmark.name.charAt(0).toUpperCase()}</span>}
                  <span className="bookmark-names">
                    <strong>{bookmark.displayName || bookmark.name}</strong>
                    <small>@{bookmark.name}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="remove-bookmark"
                  aria-label={`Remove ${bookmark.name} from saved profiles`}
                  onClick={() => removeBookmark(bookmark.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {bookmarkError && <p className="storage-warning" role="alert">{bookmarkError}</p>}

      {isLoading && (
        <div className="loading-card" role="status" aria-live="polite">
          <span className="spinner" />
          <span>Looking up public profile...</span>
        </div>
      )}

      {profile && (
        <section className="profile-card" aria-label="Roblox public profile">
          <div className="profile-banner">
            <span className="profile-tag"><span className="status-dot" /> PROFILE FOUND</span>
            <span className="profile-id">ID&nbsp; {profile.id}</span>
          </div>
          <div className="profile-content">
            <div className="avatar-wrap">
              {profile.avatarUrl ? (
                <img className="avatar" src={profile.avatarUrl} alt={`${profile.name}'s Roblox avatar`} />
              ) : (
                <div className="avatar avatar-placeholder" aria-label="Avatar unavailable">
                  {profile.name?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
              )}
            </div>
            <div className="profile-main">
              <p className="profile-label">ROBLOX ACCOUNT</p>
              <h2>{profile.displayName || profile.name}</h2>
              <p className="handle">@{profile.name}</p>
              <div className={`presence-badge presence-${presenceStatus}`}>
                <span className="presence-dot" />
                <span>{presenceLabels[presenceStatus] || 'Status unavailable'}</span>
                {presenceStatus === 'in-experience' && (
                  <span className="experience-name">
                    {currentPresence?.experienceName || currentPresence?.lastLocation || 'Experience details unavailable'}
                  </span>
                )}
              </div>
              <p className="presence-update">
                Public status refreshes every 30 seconds
                {presenceUpdatedAt && ` · Checked ${presenceUpdatedAt.toLocaleTimeString()}`}
              </p>
              {presenceError && <p className="presence-error" role="status">{presenceError}</p>}
              <p className="presence-update">
                Roblox does not provide public past-game history or hours-played data.
              </p>
              <div className="profile-details">
                <div className="detail-item">
                  <span className="detail-label">Joined</span>
                  <span className="detail-value">{createdDate}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">User ID</span>
                  <span className="detail-value">{profile.id}</span>
                </div>
              </div>
            </div>
            <a
              className="profile-link"
              href={`https://www.roblox.com/users/${profile.id}/profile`}
            >
              Open on Roblox <span aria-hidden="true">↗</span>
            </a>
            <div className="profile-actions">
              <button
                type="button"
                className={`action-button ${isBookmarked ? 'is-saved' : ''}`}
                onClick={toggleBookmark}
              >
                <span aria-hidden="true">{isBookmarked ? '★' : '☆'}</span>
                {isBookmarked ? 'Saved' : 'Bookmark'}
              </button>
              <button type="button" className="action-button" onClick={toggleFriends}>
                <span aria-hidden="true">♧</span>
                {showFriends ? 'Hide friends' : 'See friends'}
              </button>
            </div>
            <div className="description">
              <span className="detail-label">ABOUT</span>
              <p>{profile.description?.trim() || 'This player has no public description.'}</p>
            </div>
          </div>
          {showFriends && (
            <div className="friends-section">
              <div className="friends-heading">
                <div>
                  <p className="section-eyebrow">PUBLIC FRIENDS</p>
                  <h3>Friends</h3>
                </div>
                <span className="friends-count">
                  {friendCountLoading
                    ? 'Loading count...'
                    : friendCount !== null
                      ? `${friendCount} total`
                      : ''}
                </span>
              </div>
              {friendCountError && <p className="friends-message" role="status">{friendCountError}</p>}
              {friendsLoading && (
                <div className="friends-loading" role="status">
                  <span className="spinner" /> Loading friends...
                </div>
              )}
              {friendsError && <p className="friends-message" role="status">{friendsError}</p>}
              {!friendsLoading && !friendsError && friendsLoaded && friends.length === 0 && (
                <p className="friends-message">No public friends to show.</p>
              )}
              {friends.length > 0 && (
                <div className="friends-list">
                  {friends.map((friend) => (
                    <a
                      className="friend-item"
                      href={`https://www.roblox.com/users/${friend.id}/profile`}
                      key={friend.id}
                    >
                      {friend.avatarUrl
                        ? <img src={friend.avatarUrl} alt="" />
                        : <span className="friend-placeholder">{friend.name?.charAt(0)?.toUpperCase() ?? '?'}</span>}
                      <span className="friend-names">
                        <strong>{friend.displayName || friend.name}</strong>
                        <small>@{friend.name}</small>
                      </span>
                      <span className="friend-external" aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              )}
              {friendsCursor && !friendsError && (
                <button
                  type="button"
                  className="load-more-friends"
                  disabled={friendsLoading}
                  onClick={() => void loadFriends(profile.id, friendsCursor, true)}
                >
                  Load more friends
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!profile && !error && !isLoading && (
        <section className="empty-state" aria-label="How it works">
          <div className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="7" y="7" width="34" height="34" rx="8" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="24" cy="20" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M14 37c1.6-5.3 5.2-8 10-8s8.4 2.7 10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2>Your search starts here</h2>
          <p>Enter a username above to view the account’s public Roblox profile.</p>
          <div className="empty-divider"><span /> PUBLIC DATA ONLY <span /></div>
        </section>
      )}

      <section className="feedback-panel" aria-labelledby="feedback-title">
        <p className="section-eyebrow">GET IN TOUCH</p>
        <h2 id="feedback-title">Send feedback</h2>
        <p className="feedback-copy">Have a request or suggestion? Send a message directly to the site owner.</p>
        <form className="feedback-form" onSubmit={submitFeedback}>
          <label>
            Name <span>(optional)</span>
            <input
              autoComplete="name"
              maxLength={100}
              value={feedbackName}
              onChange={(event) => setFeedbackName(event.target.value)}
            />
          </label>
          <label>
            Message
            <textarea
              required
              maxLength={5000}
              rows={4}
              value={feedbackMessage}
              onChange={(event) => setFeedbackMessage(event.target.value)}
            />
          </label>
          <button type="submit" disabled={feedbackLoading}>
            {feedbackLoading ? 'Sending...' : 'Send feedback'}
          </button>
        </form>
        {feedbackStatus && <p className="feedback-result" role="status">{feedbackStatus}</p>}
        {feedbackError && <p className="feedback-result feedback-result-error" role="alert">{feedbackError}</p>}
        <p className="feedback-privacy">Messages are delivered to the site owner. The feedback form does not ask for your email address.</p>
      </section>

      <footer className="footer">
        <span>Independent community tool · Not affiliated with Roblox</span>
        <a href="https://www.roblox.com/" target="_blank" rel="noreferrer">Visit Roblox <span aria-hidden="true">↗</span></a>
      </footer>
    </main>
  )
}

export default App
