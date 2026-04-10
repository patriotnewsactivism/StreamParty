/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  onAuthStateChanged,
  doc,
  collection,
  onSnapshot,
  setDoc,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  getDocs,
  where,
  deleteDoc,
  getDoc,
  User
} from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Copy,
  Link,
  Plus,
  Play,
  Pause,
  Send,
  Smile,
  Users,
  Video,
  Upload,
  LogOut,
  ChevronRight,
  Heart,
  ThumbsUp,
  Laugh,
  Angry,
  Zap,
  Loader,
  Calendar,
  Clock,
  Mail,
  Share2,
  ExternalLink,
  ArrowLeft,
  Globe,
  Trash2,
  Eye,
  Download,
  Bell,
  X,
  Code,
  MessageCircle,
  ChevronDown
} from 'lucide-react';
import { cn } from './lib/utils';
import { getVkVideoMp4Url } from './lib/vk';

// --- Types ---

type AppPage = 'home' | 'events' | 'event-detail' | 'create-event' | 'room';

interface RouteInfo {
  page: AppPage;
  param: string;
}

interface RoomState {
  videoUrl: string;
  status: 'playing' | 'paused';
  currentTime: number;
  lastUpdated: number;
  hostId: string;
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'delivered';
}

interface Reaction {
  id: string;
  userId: string;
  emoji: string;
  timestamp: number;
}

interface UserPresence {
  uid: string;
  displayName: string;
  lastSeen: number;
  isOnline: boolean;
}

interface WatchPartyEvent {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  scheduledAt: number;
  createdAt: number;
  createdBy: string;
  creatorName: string;
  roomId: string;
  status: 'upcoming' | 'live' | 'ended';
}

interface Subscriber {
  id: string;
  email: string;
  name: string;
  subscribedAt: number;
  source: string;
}

// --- Constants ---

const DEFAULT_VIDEOS = [
  { name: 'Blue Moon', url: 'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-576p.mp4' },
  { name: 'Mux Intro', url: 'https://storage.googleapis.com/muxdemofiles/mux-video-intro.mp4' },
  { name: 'Mux Promo', url: 'https://storage.googleapis.com/muxdemofiles/mux.mp4' },
];

const REACTION_EMOJIS = [
  { icon: Heart, color: 'text-red-500', label: '❤️' },
  { icon: ThumbsUp, color: 'text-blue-500', label: '👍' },
  { icon: Laugh, color: 'text-yellow-500', label: '😂' },
  { icon: Zap, color: 'text-purple-500', label: '😮' },
  { icon: Angry, color: 'text-orange-500', label: '😡' },
];

const BASE_URL = 'https://stream-party-cyan.vercel.app';

// --- Helpers ---

function parseRoute(): RouteInfo {
  const hash = window.location.hash.slice(1);
  if (!hash || hash === 'home') return { page: 'home', param: '' };
  if (hash === 'events') return { page: 'events', param: '' };
  if (hash === 'create-event') return { page: 'create-event', param: '' };
  if (hash.startsWith('event/')) return { page: 'event-detail', param: hash.slice(6) };
  return { page: 'room', param: hash };
}

function navigate(path: string) {
  window.location.hash = path;
}

function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function formatDateTime(ts: number): string {
  return `${formatDate(ts)} at ${formatTime(ts)}`;
}

function calculateTimeLeft(target: number) {
  const diff = target - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isLive: true };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    isLive: false
  };
}

function useCountdown(targetDate: number) {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(targetDate));
  useEffect(() => {
    setTimeLeft(calculateTimeLeft(targetDate));
    const interval = setInterval(() => setTimeLeft(calculateTimeLeft(targetDate)), 1000);
    return () => clearInterval(interval);
  }, [targetDate]);
  return timeLeft;
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<RouteInfo>(parseRoute());
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);

  // Auth
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Route sync
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Subscriber count (global)
  useEffect(() => {
    const q = query(collection(db, 'subscribers'));
    return onSnapshot(q, (snap) => setSubscriberCount(snap.size));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="animate-pulse text-neutral-500 font-mono">INITIALIZING STREAM...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
      {/* Only show navbar outside of room view */}
      {route.page !== 'room' && (
        <NavBar
          user={user}
          subscriberCount={subscriberCount}
          onSubscribe={() => setShowSubscribeModal(true)}
        />
      )}

      {/* Page Router */}
      {route.page === 'home' && <HomePage user={user} />}
      {route.page === 'events' && <EventsPage user={user} />}
      {route.page === 'create-event' && <CreateEventPage user={user} />}
      {route.page === 'event-detail' && (
        <EventDetailPage
          eventId={route.param}
          user={user}
          onSubscribe={() => setShowSubscribeModal(true)}
        />
      )}
      {route.page === 'room' && <RoomView user={user} roomId={route.param} />}

      {/* Global Subscribe Modal */}
      <AnimatePresence>
        {showSubscribeModal && (
          <SubscribeModal onClose={() => setShowSubscribeModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- NavBar ---

function NavBar({ user, subscriberCount, onSubscribe }: {
  user: User;
  subscriberCount: number;
  onSubscribe: () => void;
}) {
  return (
    <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate('home')} className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center group-hover:bg-indigo-500 transition-colors">
              <Video size={16} />
            </div>
            <span className="font-bold text-sm hidden sm:block">StreamParty</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('events')}
              className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <span className="flex items-center gap-1.5"><Calendar size={14} /> Events</span>
            </button>
            <button
              onClick={() => navigate('create-event')}
              className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <span className="flex items-center gap-1.5"><Plus size={14} /> Create</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSubscribe}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 transition-colors"
          >
            <Bell size={12} />
            <span className="hidden sm:inline">Subscribe</span>
            {subscriberCount > 0 && (
              <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{subscriberCount}</span>
            )}
          </button>

          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold">
              {(user.displayName || 'A').charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block max-w-[80px] truncate">{user.displayName || 'Guest'}</span>
          </div>

          <button
            onClick={() => auth.signOut()}
            className="p-1.5 text-neutral-500 hover:text-white transition-colors"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}

// --- Login Page ---

function LoginPage() {
  const [signInLoading, setSignInLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const handleLogin = async () => {
    try {
      setError(null);
      setSignInLoading(true);
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const authError = error as { code: string };
        switch (authError.code) {
          case 'auth/popup-blocked': setError('Popup blocked. Allow popups and try again.'); break;
          case 'auth/popup-closed-by-user': setError('Popup closed before completing.'); break;
          case 'auth/unauthorized-domain': setError('Domain not authorized. Use Guest login.'); break;
          default: setError('Google sign-in failed. Try Guest login.');
        }
      } else {
        setError('Unexpected error. Try Guest login.');
      }
    } finally {
      setSignInLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!email || !password) { setError('Enter both email and password.'); return; }
    try {
      setError(null);
      setSignInLoading(true);
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const authError = error as { code: string };
        switch (authError.code) {
          case 'auth/invalid-email': setError('Invalid email.'); break;
          case 'auth/user-not-found': setError('No account with this email.'); break;
          case 'auth/wrong-password': setError('Wrong password.'); break;
          case 'auth/email-already-in-use': setError('Email already in use.'); break;
          case 'auth/weak-password': setError('Password must be 6+ characters.'); break;
          case 'auth/invalid-credential': setError(isSignUp ? 'Failed. Try Guest login.' : 'Invalid credentials. Try signing up.'); break;
          default: setError('Auth failed. Try Guest login.');
        }
      } else {
        setError('Unexpected error. Try Guest login.');
      }
    } finally {
      setSignInLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) { setError('Enter your email.'); return; }
    try {
      setError(null);
      await sendPasswordResetEmail(auth, email);
      setError('Reset email sent. Check your inbox.');
    } catch { setError('Failed to send reset email.'); }
  };

  const handleAnonymousSignIn = async () => {
    try {
      setError(null);
      setSignInLoading(true);
      await signInAnonymously(auth);
    } catch { setError('Failed to sign in. Try again.'); }
    finally { setSignInLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      <div className="absolute inset-0">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-indigo-500/20 rounded-full"
            animate={{ scale: [0, 1, 0], opacity: [0, 0.5, 0] }}
            transition={{ duration: 3, delay: Math.random() * 2, repeat: Infinity, repeatDelay: Math.random() * 3 }}
            style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full space-y-6 relative z-10"
      >
        <div className="space-y-4">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: "spring" }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white mb-4 shadow-2xl shadow-indigo-500/25">
            <Video size={36} />
          </motion.div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent">StreamParty</h1>
          <p className="text-neutral-400 text-lg">Watch videos together in real-time.</p>
          <p className="text-neutral-600 text-xs tracking-wider uppercase">by Don Matthews</p>
        </div>

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="bg-red-600/20 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
            {error}
          </motion.div>
        )}

        <button onClick={handleLogin} disabled={signInLoading}
          className="w-full py-4 px-6 bg-gradient-to-r from-white to-neutral-200 text-black font-semibold rounded-xl hover:shadow-xl hover:shadow-white/20 transition-all flex items-center justify-center gap-3 disabled:opacity-70">
          {signInLoading ? <><Loader className="w-5 h-5 animate-spin" /> Signing in...</>
            : <><img src="/google.svg" className="w-5 h-5" alt="Google" /> Sign in with Google </>}
        </button>

        <div className="flex items-center w-full">
          <div className="flex-1 h-px bg-neutral-700" />
          <span className="px-4 text-neutral-500 text-sm">or</span>
          <div className="flex-1 h-px bg-neutral-700" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleEmailAuth(); }} className="space-y-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="space-y-1">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            {!isSignUp && (
              <div className="text-right">
                <button type="button" onClick={handlePasswordReset} className="text-xs text-indigo-400 hover:text-indigo-300">Forgot password?</button>
              </div>
            )}
          </div>
          <button type="submit" disabled={signInLoading}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-70">
            {signInLoading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="text-sm text-neutral-400">
          {isSignUp ? 'Have an account?' : "No account?"}{' '}
          <button onClick={() => setIsSignUp(!isSignUp)} className="text-indigo-400 hover:text-indigo-300 underline">
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </div>

        <div className="flex items-center w-full">
          <div className="flex-1 h-px bg-neutral-700" />
          <span className="px-4 text-neutral-500 text-sm">or</span>
          <div className="flex-1 h-px bg-neutral-700" />
        </div>

        <button onClick={handleAnonymousSignIn} disabled={signInLoading}
          className="w-full py-3 bg-neutral-700 hover:bg-neutral-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-70 flex items-center justify-center gap-3">
          {signInLoading ? <><Loader className="w-5 h-5 animate-spin" /> Signing in...</>
            : <><Users size={20} /> Continue as Guest</>}
        </button>

        <p className="text-xs text-neutral-600">Join viewers watching together</p>
      </motion.div>
    </div>
  );
}

// --- Home Page ---

function HomePage({ user }: { user: User }) {
  const [events, setEvents] = useState<WatchPartyEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('scheduledAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const now = Date.now();
      const evts = snap.docs.map(d => ({ id: d.id, ...d.data() } as WatchPartyEvent))
        .filter(e => e.scheduledAt > now - 3600000); // show events from last hour onwards
      setEvents(evts);
      setLoadingEvents(false);
    });
  }, []);

  return (
    <div className="flex-1">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/10 to-transparent" />
        <div className="max-w-6xl mx-auto px-4 py-16 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-6">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">
              Watch Together.<br />
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">React Together.</span>
            </h1>
            <p className="text-neutral-400 text-lg max-w-xl mx-auto">
              Create watch parties, schedule events, and bring your audience together for synchronized video experiences.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button onClick={() => { const id = generateRoomId(); navigate(id); }}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors flex items-center gap-2">
                <Play size={18} /> Start a Room
              </button>
              <button onClick={() => navigate('create-event')}
                className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl font-semibold transition-colors flex items-center gap-2">
                <Calendar size={18} /> Schedule Watch Party
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Upcoming Events */}
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2"><Calendar size={20} /> Upcoming Watch Parties</h2>
          <button onClick={() => navigate('events')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            View All <ChevronRight size={14} />
          </button>
        </div>

        {loadingEvents ? (
          <div className="text-center py-12 text-neutral-500">Loading events...</div>
        ) : events.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-center py-16 space-y-4">
            <Calendar size={48} className="mx-auto text-neutral-700" />
            <p className="text-neutral-500">No upcoming watch parties yet.</p>
            <button onClick={() => navigate('create-event')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors">
              Create the First One
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.slice(0, 6).map((evt, i) => (
              <EventCard key={evt.id} event={evt} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Quick Room Entry */}
      <div className="max-w-6xl mx-auto px-4 py-12 border-t border-neutral-800">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-semibold">Or jump into a room right now</h3>
          <QuickRoomEntry />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-800 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-xs text-neutral-600">
          StreamParty by Don Matthews · Watch videos together in real-time
        </div>
      </footer>
    </div>
  );
}

function QuickRoomEntry() {
  const [roomCode, setRoomCode] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); navigate(roomCode || generateRoomId()); }} className="flex items-center gap-2 max-w-sm mx-auto">
      <input type="text" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        placeholder="Enter room code or leave blank"
        className="flex-1 px-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
      <button type="submit" className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
        Join Room
      </button>
    </form>
  );
}

// --- Event Card ---

function EventCard({ event, index }: { key?: React.Key; event: WatchPartyEvent; index: number }) {
  const countdown = useCountdown(event.scheduledAt);
  const isLive = countdown.isLive;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ scale: 1.02, y: -2 }}
      onClick={() => navigate(`event/${event.id}`)}
      className="text-left p-5 rounded-xl border border-neutral-800 bg-neutral-900 hover:border-neutral-700 transition-all group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative z-10 space-y-3">
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-semibold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live Now
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-[10px] font-semibold uppercase tracking-wider">
            <Clock size={10} /> Upcoming
          </span>
        )}

        <h3 className="font-bold text-sm leading-tight line-clamp-2">{event.title}</h3>

        {event.description && (
          <p className="text-xs text-neutral-500 line-clamp-2">{event.description}</p>
        )}

        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
          <Calendar size={10} />
          {formatDate(event.scheduledAt)}
          <span className="text-neutral-700">•</span>
          <Clock size={10} />
          {formatTime(event.scheduledAt)}
        </div>

        {!isLive && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400">Starts in:</span>
            <span className="font-mono text-indigo-400">
              {countdown.days > 0 && `${countdown.days}d `}
              {countdown.hours}h {countdown.minutes}m {countdown.seconds}s
            </span>
          </div>
        )}

        <div className="text-[10px] text-neutral-600">by {event.creatorName}</div>
      </div>
    </motion.button>
  );
}

// --- Events Page ---

function EventsPage({ user }: { user: User }) {
  const [events, setEvents] = useState<WatchPartyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('scheduledAt', 'asc'));
    return onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as WatchPartyEvent)));
      setLoading(false);
    });
  }, []);

  const now = Date.now();
  const filtered = events.filter(e => {
    if (filter === 'upcoming') return e.scheduledAt > now - 3600000;
    if (filter === 'past') return e.scheduledAt <= now - 3600000;
    return true;
  });

  return (
    <div className="flex-1 max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Watch Parties</h1>
          <p className="text-sm text-neutral-500">Browse and join scheduled events</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-neutral-800 rounded-lg p-0.5">
            {(['upcoming', 'past', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                  filter === f ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-white")}>
                {f}
              </button>
            ))}
          </div>
          <button onClick={() => navigate('create-event')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5">
            <Plus size={14} /> New Event
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-500"><Loader className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <Calendar size={48} className="mx-auto text-neutral-700" />
          <p className="text-neutral-500">{filter === 'upcoming' ? 'No upcoming events.' : 'No events found.'}</p>
          <button onClick={() => navigate('create-event')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors">
            Create One
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((evt, i) => <EventCard key={evt.id} event={evt} index={i} />)}
        </div>
      )}
    </div>
  );
}

// --- Event Detail Page ---

function EventDetailPage({ eventId, user, onSubscribe }: {
  eventId: string;
  user: User;
  onSubscribe: () => void;
}) {
  const [event, setEvent] = useState<WatchPartyEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEmbed, setShowEmbed] = useState(false);
  const [copied, setCopied] = useState('');
  const [viewerCount, setViewerCount] = useState(0);

  useEffect(() => {
    const ref = doc(db, 'events', eventId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setEvent({ id: snap.id, ...snap.data() } as WatchPartyEvent);
      }
      setLoading(false);
    });
  }, [eventId]);

  // Track viewer count via room presence
  useEffect(() => {
    if (!event?.roomId) return;
    const q = query(collection(db, 'rooms', event.roomId, 'presence'));
    return onSnapshot(q, (snap) => {
      const now = Date.now();
      const online = snap.docs.filter(d => now - (d.data().lastSeen || 0) < 60000);
      setViewerCount(online.length);
    });
  }, [event?.roomId]);

  const countdown = useCountdown(event?.scheduledAt || Date.now() + 999999999);
  const isLive = event ? event.scheduledAt <= Date.now() : false;

  const copyLink = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const eventUrl = `${BASE_URL}/#event/${eventId}`;
  const roomUrl = event ? `${BASE_URL}/#${event.roomId}` : '';

  const shareOnTwitter = () => {
    const text = event ? `Join me for "${event.title}" on StreamParty! ${eventUrl}` : '';
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareOnFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-neutral-500" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-neutral-500">Event not found.</p>
          <button onClick={() => navigate('events')} className="text-indigo-400 hover:text-indigo-300 text-sm">← Back to Events</button>
        </div>
      </div>
    );
  }

  const isCreator = event.createdBy === user.uid;

  return (
    <div className="flex-1 max-w-4xl mx-auto px-4 py-8">
      <button onClick={() => navigate('events')}
        className="flex items-center gap-1 text-sm text-neutral-500 hover:text-white mb-6 transition-colors">
        <ArrowLeft size={14} /> Back to Events
      </button>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        {/* Event Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Live Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
                <Clock size={12} /> Upcoming
              </span>
            )}
            {viewerCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-800 text-neutral-400 text-xs">
                <Eye size={12} /> {viewerCount} watching
              </span>
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold">{event.title}</h1>
          {event.description && <p className="text-neutral-400 text-lg leading-relaxed">{event.description}</p>}

          <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
            <span className="flex items-center gap-1.5"><Calendar size={14} /> {formatDateTime(event.scheduledAt)}</span>
            <span className="flex items-center gap-1.5"><Users size={14} /> by {event.creatorName}</span>
          </div>
        </div>

        {/* Countdown Timer */}
        {!isLive && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
            className="p-8 rounded-2xl bg-gradient-to-br from-indigo-600/10 to-purple-600/10 border border-indigo-500/20">
            <p className="text-sm text-neutral-400 mb-4 text-center uppercase tracking-wider">Starts In</p>
            <div className="flex items-center justify-center gap-4 sm:gap-8">
              {[
                { label: 'Days', value: countdown.days },
                { label: 'Hours', value: countdown.hours },
                { label: 'Minutes', value: countdown.minutes },
                { label: 'Seconds', value: countdown.seconds },
              ].map((unit) => (
                <div key={unit.label} className="text-center">
                  <div className="text-3xl sm:text-5xl font-bold font-mono text-white">
                    {String(unit.value).padStart(2, '0')}
                  </div>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">{unit.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {isLive ? (
            <button onClick={() => navigate(event.roomId)}
              className="flex-1 py-3.5 px-6 bg-red-600 hover:bg-red-500 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 text-lg">
              <Play size={20} /> Join Watch Party
            </button>
          ) : (
            <button onClick={() => navigate(event.roomId)}
              className="flex-1 py-3.5 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
              <Play size={18} /> Enter Room Early
            </button>
          )}
          <button onClick={onSubscribe}
            className="py-3.5 px-6 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
            <Bell size={18} /> Subscribe for Updates
          </button>
        </div>

        {/* Social Sharing */}
        <div className="p-6 rounded-xl bg-neutral-900 border border-neutral-800 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Share2 size={16} /> Share This Event</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={shareOnTwitter}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors flex items-center gap-2">
              <Globe size={14} /> Twitter
            </button>
            <button onClick={shareOnFacebook}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors flex items-center gap-2">
              <Globe size={14} /> Facebook
            </button>
            <button onClick={() => copyLink(eventUrl, 'event')}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors flex items-center gap-2">
              <Copy size={14} /> {copied === 'event' ? 'Copied!' : 'Copy Event Link'}
            </button>
            <button onClick={() => copyLink(roomUrl, 'room')}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors flex items-center gap-2">
              <Link size={14} /> {copied === 'room' ? 'Copied!' : 'Copy Room Link'}
            </button>
            <button onClick={() => setShowEmbed(!showEmbed)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors flex items-center gap-2">
              <Code size={14} /> Embed
            </button>
          </div>

          {/* Embed Code */}
          <AnimatePresence>
            {showEmbed && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <div className="mt-2 space-y-3">
                  <p className="text-xs text-neutral-500">Paste this code on any website to embed this event:</p>
                  <div className="relative">
                    <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-neutral-400 overflow-x-auto">
{`<iframe src="${BASE_URL}/#${event.roomId}"
  width="100%" height="500"
  frameborder="0"
  allow="autoplay; fullscreen"
  style="border-radius: 12px; border: 1px solid #333;">
</iframe>`}
                    </pre>
                    <button onClick={() => {
                      navigator.clipboard.writeText(`<iframe src="${BASE_URL}/#${event.roomId}" width="100%" height="500" frameborder="0" allow="autoplay; fullscreen" style="border-radius: 12px; border: 1px solid #333;"></iframe>`);
                      setCopied('embed');
                      setTimeout(() => setCopied(''), 2000);
                    }}
                      className="absolute top-2 right-2 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px] transition-colors">
                      {copied === 'embed' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Delete (creator only) */}
        {isCreator && (
          <div className="pt-4 border-t border-neutral-800">
            <button onClick={async () => {
              if (confirm('Delete this event?')) {
                await deleteDoc(doc(db, 'events', eventId));
                navigate('events');
              }
            }}
              className="text-sm text-red-500 hover:text-red-400 flex items-center gap-1.5 transition-colors">
              <Trash2 size={14} /> Delete Event
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// --- Create Event Page ---

function CreateEventPage({ user }: { user: User }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!date || !time) { setError('Pick a date and time.'); return; }

    const scheduledAt = new Date(`${date}T${time}`).getTime();
    if (scheduledAt < Date.now()) { setError('Event must be in the future.'); return; }

    setCreating(true);
    setError('');

    try {
      const eventId = generateEventId();
      const roomId = `party-${generateRoomId()}`;

      await setDoc(doc(db, 'events', eventId), {
        title: title.trim(),
        description: description.trim(),
        videoUrl: videoUrl.trim() || DEFAULT_VIDEOS[0].url,
        scheduledAt,
        createdAt: Date.now(),
        createdBy: user.uid,
        creatorName: user.displayName || 'Anonymous',
        roomId,
        status: 'upcoming'
      });

      // Pre-create the room with the video
      await setDoc(doc(db, 'rooms', roomId), {
        videoUrl: videoUrl.trim() || DEFAULT_VIDEOS[0].url,
        status: 'paused',
        currentTime: 0,
        lastUpdated: Date.now(),
        hostId: user.uid
      });

      navigate(`event/${eventId}`);
    } catch (err) {
      console.error('Failed to create event:', err);
      setError('Failed to create event. Try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 max-w-2xl mx-auto px-4 py-8">
      <button onClick={() => navigate('events')}
        className="flex items-center gap-1 text-sm text-neutral-500 hover:text-white mb-6 transition-colors">
        <ArrowLeft size={14} /> Back
      </button>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-2">Schedule a Watch Party</h1>
        <p className="text-sm text-neutral-500 mb-8">Create an event with a shareable page and countdown timer.</p>

        {error && (
          <div className="bg-red-600/20 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg mb-6">{error}</div>
        )}

        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Event Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday Night Movie Watch Party"
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500"
              maxLength={100} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what you'll be watching and why they should join..."
              rows={3}
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500 resize-none"
              maxLength={500} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Time *</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Video URL</label>
            <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://... (leave blank for default)"
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
            <p className="text-xs text-neutral-600 mt-1">Supports direct MP4 links and VK video URLs</p>
          </div>

          <button type="submit" disabled={creating}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors disabled:opacity-70 flex items-center justify-center gap-2">
            {creating ? <><Loader className="w-5 h-5 animate-spin" /> Creating...</> : <><Calendar size={18} /> Create Watch Party</>}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// --- Subscribe Modal ---

function SubscribeModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) { setError('Enter a valid email.'); return; }

    setSubmitting(true);
    setError('');

    try {
      // Check if already subscribed
      const q = query(collection(db, 'subscribers'), where('email', '==', email.trim().toLowerCase()));
      const existing = await getDocs(q);
      if (!existing.empty) {
        setSuccess(true);
        return;
      }

      await addDoc(collection(db, 'subscribers'), {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        subscribedAt: Date.now(),
        source: 'modal'
      });
      setSuccess(true);
    } catch (err) {
      console.error('Subscribe failed:', err);
      setError('Failed to subscribe. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><Bell size={18} className="text-indigo-400" /> Subscribe for Updates</h2>
          <button onClick={onClose} className="p-1 text-neutral-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>

        {success ? (
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center py-6 space-y-3">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <Mail size={28} className="text-green-400" />
            </div>
            <p className="text-green-400 font-semibold">You're subscribed!</p>
            <p className="text-sm text-neutral-500">You'll get updates about new watch parties.</p>
            <button onClick={onClose} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors">Close</button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-neutral-400">Get notified about upcoming watch parties and events.</p>

            {error && <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">{error}</div>}

            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address *" required
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />

            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition-colors disabled:opacity-70 flex items-center justify-center gap-2">
              {submitting ? <><Loader className="w-4 h-4 animate-spin" /> Subscribing...</> : <><Mail size={16} /> Subscribe</>}
            </button>

            <p className="text-[10px] text-neutral-600 text-center">No spam. Unsubscribe anytime.</p>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

// --- Room View (existing functionality, refactored) ---

function RoomView({ user, roomId }: { user: User; roomId: string }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [actualVideoUrl, setActualVideoUrl] = useState<string>('');
  const [vkUrl, setVkUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const syncIgnoreRef = useRef(false);
  const presenceRef = useRef<any>(null);

  const ROOM_ID = roomId;

  // Subscriber count
  useEffect(() => {
    const q = query(collection(db, 'subscribers'));
    return onSnapshot(q, (snap) => setSubscriberCount(snap.size));
  }, []);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(`${BASE_URL}/#${ROOM_ID}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const createNewRoom = () => {
    const id = generateRoomId();
    navigate(id);
  };

  // Room State Sync
  useEffect(() => {
    if (!user) return;
    const roomRef = doc(db, 'rooms', ROOM_ID);
    return onSnapshot(roomRef, (snapshot) => {
      try {
        if (snapshot.exists()) {
          const data = snapshot.data() as RoomState;
          const newIsHost = data.hostId === user.uid;
          setRoomState(data);
          setIsHost(newIsHost);
          setError(null);

          if (videoRef.current && !syncIgnoreRef.current) {
            const video = videoRef.current;
            const timeDiff = Math.abs(video.currentTime - data.currentTime);
            const timeSinceUpdate = Date.now() - data.lastUpdated;

            if (!newIsHost || timeSinceUpdate < 5000) {
              if (timeDiff > 1 || (data.status === 'playing' && video.paused) || (data.status === 'paused' && !video.paused)) {
                setTimeout(() => {
                  if (video && !syncIgnoreRef.current) {
                    video.currentTime = data.currentTime;
                    if (data.status === 'playing') {
                      video.play().catch(() => {});
                    } else {
                      video.pause();
                    }
                  }
                }, 100);
              }
            }
          }
        } else {
          setDoc(roomRef, {
            videoUrl: DEFAULT_VIDEOS[0].url,
            status: 'paused',
            currentTime: 0,
            lastUpdated: Date.now(),
            hostId: user.uid
          }).catch(() => setError('Failed to initialize room.'));
        }
      } catch { setError('Failed to sync with room.'); }
    }, () => setError('Lost connection to room.'));
  }, [user, isHost, ROOM_ID]);

  // Auto-claim host
  useEffect(() => {
    if (!user || !roomState || isHost) return;
    const hostOnline = onlineUsers.some(u => u.uid === roomState.hostId);
    if (!hostOnline && onlineUsers.length > 0) {
      updateRoomState({ hostId: user.uid });
    }
  }, [user, roomState, isHost, onlineUsers]);

  // VK Video URL
  useEffect(() => {
    if (!roomState?.videoUrl) { setActualVideoUrl(''); return; }
    if (roomState.videoUrl.startsWith('https://vk.com/video')) {
      setVideoLoading(true);
      getVkVideoMp4Url(roomState.videoUrl, (import.meta as any).env.VITE_VK_TOKEN || '')
        .then(url => setActualVideoUrl(url))
        .catch(() => { setError('Failed to load VK video.'); setActualVideoUrl(''); })
        .finally(() => setVideoLoading(false));
    } else {
      setActualVideoUrl(roomState.videoUrl);
    }
  }, [roomState?.videoUrl]);

  // Chat Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms', ROOM_ID, 'messages'), orderBy('timestamp', 'desc'), limit(50));
    return onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(msgs.reverse());
    });
  }, [user, ROOM_ID]);

  // Reactions
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms', ROOM_ID, 'reactions'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, (snap) => {
      const rs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reaction));
      const now = Date.now();
      setReactions(rs.filter(r => now - r.timestamp < 5000));
    });
  }, [user, ROOM_ID]);

  // Presence
  useEffect(() => {
    if (!user) return;
    const presenceDocRef = doc(db, 'rooms', ROOM_ID, 'presence', user.uid);
    presenceRef.current = { uid: user.uid, displayName: user.displayName || 'Anonymous', lastSeen: Date.now(), isOnline: true };

    const updatePresence = () => {
      setDoc(presenceDocRef, { ...presenceRef.current, lastSeen: Date.now() }, { merge: true });
    };
    updatePresence();

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(e => document.addEventListener(e, updatePresence, { passive: true }));
    const heartbeat = setInterval(updatePresence, 30000);

    const presenceQuery = query(collection(db, 'rooms', ROOM_ID, 'presence'));
    const unsub = onSnapshot(presenceQuery, (snap) => {
      const now = Date.now();
      setOnlineUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserPresence)).filter(u => now - u.lastSeen < 60000));
    });

    const cleanup = () => setDoc(presenceDocRef, { ...presenceRef.current, isOnline: false, lastSeen: Date.now() }, { merge: true });
    window.addEventListener('beforeunload', cleanup);

    return () => {
      cleanup();
      clearInterval(heartbeat);
      events.forEach(e => document.removeEventListener(e, updatePresence));
      window.removeEventListener('beforeunload', cleanup);
      unsub();
    };
  }, [user, ROOM_ID]);

  // Host time sync
  useEffect(() => {
    if (!isHost || !user || roomState?.status !== 'playing') return;
    const interval = setInterval(() => {
      if (videoRef.current && !syncIgnoreRef.current) {
        const currentTime = videoRef.current.currentTime;
        if (!roomState || Math.abs(currentTime - roomState.currentTime) > 0.5) {
          updateRoomState({ currentTime });
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, user, roomState?.status, roomState?.currentTime]);

  const updateRoomState = async (updates: Partial<RoomState>) => {
    if (!user || !roomState) return;
    const roomRef = doc(db, 'rooms', ROOM_ID);
    await setDoc(roomRef, { ...roomState, ...updates, lastUpdated: Date.now() }, { merge: true });
  };

  const handleVideoAction = () => {
    if (!videoRef.current || !user) return;
    syncIgnoreRef.current = true;
    const newStatus = videoRef.current.paused ? 'playing' : 'paused';
    updateRoomState({ status: newStatus, currentTime: videoRef.current.currentTime, hostId: user.uid });
    if (newStatus === 'playing') { videoRef.current.play().catch(() => {}); } else { videoRef.current.pause(); }
    setTimeout(() => { syncIgnoreRef.current = false; }, 500);
  };

  const sendMessage = async (text: string) => {
    if (!user || !text.trim()) return;
    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, userId: user.uid, userName: user.displayName || 'Anonymous', text, timestamp: Date.now(), status: 'sending' }]);
    try {
      await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), { roomId: ROOM_ID, userId: user.uid, userName: user.displayName || 'Anonymous', text, timestamp: Date.now() });
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'sent' as const } : m));
    } catch { setMessages(prev => prev.filter(m => m.id !== tempId)); }
  };

  const sendReaction = async (emoji: string) => {
    if (!user) return;
    try {
      if (navigator.vibrate) navigator.vibrate(50);
      await addDoc(collection(db, 'rooms', ROOM_ID, 'reactions'), { roomId: ROOM_ID, userId: user.uid, emoji, timestamp: Date.now() });
    } catch {}
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-screen">
      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-h-0">
        {/* Header */}
        <header className="p-3 sm:p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('home')} className="w-10 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center transition-colors">
              <Video size={20} />
            </button>
            <div>
              <h2 className="font-bold text-sm leading-tight">StreamParty</h2>
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Room: {ROOM_ID}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <button onClick={copyRoomLink}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 transition-colors text-xs font-medium">
              {copied ? <><Copy size={12} /> Copied!</> : <><Link size={12} /> Share</>}
            </button>
            <button onClick={createNewRoom}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition-colors text-xs font-medium">
              <Plus size={12} /> New Room
            </button>
            <button onClick={() => navigate('events')}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition-colors text-xs font-medium">
              <Calendar size={12} /> Events
            </button>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800">
              <Users size={14} className="text-neutral-500" />
              <span className="text-xs font-medium">{onlineUsers.length}</span>
            </div>

            {/* Chat Toggle */}
            <button onClick={() => setShowChat(!showChat)}
              className={cn("p-2 rounded-lg transition-colors relative", showChat ? "bg-indigo-600/20 text-indigo-400" : "text-neutral-500 hover:text-white")}
              title="Toggle Chat">
              <MessageCircle size={20} />
              {messages.length > 0 && !showChat && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
              )}
            </button>

            <button onClick={() => auth.signOut()} className="p-2 text-neutral-500 hover:text-white transition-colors" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-600/90 text-white px-4 py-2 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-4 text-red-200 hover:text-white">✕</button>
          </div>
        )}

        {/* Video Area */}
        <div className="flex-1 bg-black relative group flex items-center justify-center overflow-hidden">
          {roomState?.videoUrl ? (
            <>
              <video ref={videoRef} src={actualVideoUrl}
                className="w-full h-full object-contain"
                onPlay={() => { if (syncIgnoreRef.current || !isHost) return; updateRoomState({ status: 'playing' }); }}
                onPause={() => { if (syncIgnoreRef.current || !isHost) return; updateRoomState({ status: 'paused' }); }}
                onSeeked={() => { if (syncIgnoreRef.current || !isHost) return; updateRoomState({ currentTime: videoRef.current?.currentTime || 0 }); }}
                controls={false}
                onLoadedData={() => setVideoLoading(false)}
                onLoadStart={() => setVideoLoading(true)}
              />

              {/* Video Controls Overlay */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute inset-0 flex items-center justify-center">
                  <button onClick={handleVideoAction}
                    className="p-4 rounded-full bg-black/60 backdrop-blur-md border border-white/20 hover:bg-black/80 transition-all transform hover:scale-110 active:scale-95 cursor-pointer">
                    {roomState?.status === 'playing' ? <Pause size={32} className="text-white" /> : <Play size={32} className="text-white ml-1" />}
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center gap-4 text-white">
                    <div className="flex-1 relative">
                      <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-200"
                          style={{ width: videoRef.current ? `${(videoRef.current.currentTime / videoRef.current.duration) * 100}%` : '0%' }} />
                      </div>
                    </div>
                    <div className="text-xs font-mono text-neutral-300">
                      {videoRef.current
                        ? `${Math.floor(videoRef.current.currentTime / 60)}:${(videoRef.current.currentTime % 60).toFixed(0).padStart(2, '0')} / ${Math.floor((videoRef.current.duration || 0) / 60)}:${((videoRef.current.duration || 0) % 60).toFixed(0).padStart(2, '0')}`
                        : '0:00 / 0:00'}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-neutral-700 font-mono text-sm">NO VIDEO SELECTED</div>
          )}

          {videoLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-500 border-t-transparent" />
            </div>
          )}

          {/* Reaction Overlay */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <AnimatePresence>
              {reactions.map(r => <FloatingEmoji key={r.id} emoji={r.emoji} />)}
            </AnimatePresence>
          </div>

          {/* Host Status */}
          {!isHost && roomState && (
            <div className="absolute top-6 left-6 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Watching with Host
            </div>
          )}

          {roomState?.status === 'paused' && actualVideoUrl && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-indigo-600/80 backdrop-blur-md text-xs font-medium animate-pulse">
              Hover &amp; click play to start
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="p-4 sm:p-6 border-t border-neutral-800 bg-neutral-900/30">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">Video Library</h3>
                <p className="text-xs text-neutral-500">Select a video to broadcast.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowSubscribeModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 rounded-lg text-xs font-medium transition-colors sm:hidden">
                  <Bell size={12} /> Subscribe
                  {subscriberCount > 0 && <span className="bg-indigo-600 text-white text-[10px] px-1 rounded-full">{subscriberCount}</span>}
                </button>
                <label className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer transition-colors text-xs font-medium">
                  <Upload size={14} /> Upload
                  <input type="file" className="hidden" accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        updateRoomState({ videoUrl: url, currentTime: 0, status: 'paused', hostId: user.uid });
                      }
                    }} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {DEFAULT_VIDEOS.map(v => (
                <button key={v.url}
                  onClick={() => updateRoomState({ videoUrl: v.url, currentTime: 0, status: 'paused', hostId: user.uid })}
                  className={cn(
                    "p-4 rounded-xl border text-left transition-all group relative overflow-hidden",
                    roomState?.videoUrl === v.url
                      ? "bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border-indigo-500/50 shadow-lg shadow-indigo-500/20"
                      : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                  )}>
                  <div className="relative z-10">
                    <div className="text-sm font-bold mb-2 truncate">{v.name}</div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-tighter flex items-center gap-1"><Video size={10} /> Public Library</div>
                  </div>
                  {roomState?.videoUrl === v.url && (
                    <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 shadow-[0_0_12px_rgba(99,102,241,0.8)] animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            {/* VK Video */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">VK Video</h4>
              <div className="flex gap-2">
                <input type="url" placeholder="https://vk.com/video-12345678_87654321" value={vkUrl}
                  onChange={(e) => setVkUrl(e.target.value)}
                  className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={() => { if (vkUrl) { updateRoomState({ videoUrl: vkUrl, currentTime: 0, status: 'paused', hostId: user.uid }); setVkUrl(''); } }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors">
                  Load
                </button>
              </div>
            </div>

            {/* Share Row */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-800">
              <span className="text-xs text-neutral-500 mr-1">Share:</span>
              <button onClick={copyRoomLink}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5">
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <button onClick={() => {
                const text = `Watch with me on StreamParty! ${BASE_URL}/#${ROOM_ID}`;
                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
              }}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5">
                <Globe size={12} /> Twitter
              </button>
              <button onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${BASE_URL}/#${ROOM_ID}`)}`, '_blank')}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5">
                <Globe size={12} /> Facebook
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Chat Backdrop (mobile) */}
      <AnimatePresence>
        {showChat && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowChat(false)} />
        )}
      </AnimatePresence>

      {/* Chat Sidebar */}
      <AnimatePresence>
        {showChat && (
          <motion.aside
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed lg:relative top-0 right-0 z-50 w-full sm:w-96 h-full border-l border-neutral-800 flex flex-col bg-neutral-950"
          >
            {/* Close Button */}
            <div className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} className="text-indigo-400" />
                <span className="text-sm font-semibold">Chat</span>
                <span className="text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded-full">{onlineUsers.length} online</span>
              </div>
              <button onClick={() => setShowChat(false)}
                className="p-1.5 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors" title="Close chat">
                <X size={18} />
              </button>
            </div>

            {/* Reactions Bar */}
            <div className="p-3 border-b border-neutral-800">
              <div className="flex items-center justify-around">
                {REACTION_EMOJIS.map(emoji => (
                  <button key={emoji.label} onClick={() => sendReaction(emoji.label)} data-emoji={emoji.label}
                    className="p-2.5 rounded-full hover:bg-neutral-900 transition-all group">
                    <emoji.icon className={cn("w-5 h-5", emoji.color)} />
                  </button>
                ))}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-2">
                  <Smile size={32} strokeWidth={1} />
                  <p className="text-xs font-mono">NO MESSAGES YET</p>
                </div>
              ) : (
                messages.map(m => {
                  const isOwn = m.userId === user.uid;
                  return (
                    <div key={m.id} className={cn("flex gap-3 max-w-[85%]", isOwn ? "ml-auto flex-row-reverse" : "")}>
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                        isOwn ? "bg-indigo-600 text-white" : "bg-neutral-700 text-neutral-300")}>
                        {m.userName.charAt(0).toUpperCase()}
                      </div>
                      <div className={cn("flex flex-col gap-1", isOwn ? "items-end" : "items-start")}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-neutral-400">{isOwn ? 'You' : m.userName}</span>
                          <span className="text-[9px] text-neutral-600 font-mono">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={cn("px-3 py-2 rounded-2xl text-sm leading-relaxed break-words",
                          isOwn ? "bg-indigo-600 text-white rounded-br-md" : "bg-neutral-800 text-neutral-200 rounded-bl-md")}>
                          {m.text}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-neutral-800 bg-neutral-900/20">
              <ChatInput onSend={sendMessage} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Subscribe Modal (in-room) */}
      <AnimatePresence>
        {showSubscribeModal && <SubscribeModal onClose={() => setShowSubscribeModal(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Chat Input ---

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input type="text" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Say something..."
        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all placeholder:text-neutral-600"
        maxLength={500} />
      <button type="submit" disabled={!text.trim()}
        className={cn("absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all",
          text.trim() ? "text-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/10" : "text-neutral-600 cursor-not-allowed")}>
        <Send size={18} />
      </button>
    </form>
  );
}

// --- Floating Emoji ---

function FloatingEmoji({ emoji }: { key?: React.Key; emoji: string }) {
  const randomX = useMemo(() => Math.random() * 80 + 10, []);
  const randomDuration = useMemo(() => 3 + Math.random() * 2, []);
  const randomScale = useMemo(() => 0.6 + Math.random() * 0.8, []);
  const randomRotation = useMemo(() => Math.random() * 60 - 30, []);

  return (
    <motion.div
      initial={{ y: '100%', x: `${randomX}%`, opacity: 0, scale: 0, rotate: 0 }}
      animate={{
        y: '-20%',
        opacity: [0, 1, 1, 0.8, 0],
        scale: [0, randomScale, randomScale * 1.2, randomScale],
        rotate: [0, randomRotation, randomRotation * 0.5, 0],
        x: [`${randomX}%`, `${randomX + (Math.random() * 30 - 15)}%`]
      }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ duration: randomDuration, ease: [0.25, 0.46, 0.45, 0.94], times: [0, 0.2, 0.8, 1] }}
      className="absolute bottom-0 text-4xl select-none pointer-events-none z-50 drop-shadow-lg"
    >
      {emoji}
    </motion.div>
  );
}
