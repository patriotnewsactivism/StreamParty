/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  getDocs,
  where,
  deleteDoc,
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
  CheckCircle,
  UserPlus,
  Tv,
  PartyPopper,
  RotateCcw,
  StopCircle
} from 'lucide-react';
import { cn } from './lib/utils';
import { getVkVideoMp4Url } from './lib/vk';

// --- Types ---

type AppPage = 'home' | 'events' | 'event-detail' | 'create-event' | 'room' | 'replay';

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
  endedAt?: number;
  rsvpCount?: number;
}

interface RSVP {
  id: string;
  email: string;
  name: string;
  createdAt: number;
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

const BASE_URL = 'https://donmatthews.live';
const REPLAY_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours in ms

// --- Helpers ---

function parseRoute(): RouteInfo {
  const hash = window.location.hash.slice(1);
  if (!hash || hash === 'home') return { page: 'home', param: '' };
  if (hash === 'events') return { page: 'events', param: '' };
  if (hash === 'create-event') return { page: 'create-event', param: '' };
  if (hash.startsWith('event/')) return { page: 'event-detail', param: hash.slice(6) };
  if (hash.startsWith('replay/')) return { page: 'replay', param: hash.slice(7) };
  return { page: 'room', param: hash };
}

function navigate(path: string) {
  window.location.hash = path;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
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

function isReplayAvailable(event: WatchPartyEvent): boolean {
  if (!event.endedAt) return false;
  return Date.now() - event.endedAt < REPLAY_WINDOW_MS;
}

function replayExpiresAt(event: WatchPartyEvent): number {
  return (event.endedAt || 0) + REPLAY_WINDOW_MS;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function useCountdown(targetDate: number) {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(targetDate));
  useEffect(() => {
    setTimeLeft(calculateTimeLeft(targetDate));
    const iv = setInterval(() => setTimeLeft(calculateTimeLeft(targetDate)), 1000);
    return () => clearInterval(iv);
  }, [targetDate]);
  return timeLeft;
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState<RouteInfo>(parseRoute());

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
  }, []);

  useEffect(() => {
    const fn = () => setRoute(parseRoute());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);

  // Public pages — no login required
  if (route.page === 'home') return <HomePage user={user} authLoading={authLoading} />;
  if (route.page === 'events') return <EventsPage user={user} authLoading={authLoading} />;
  if (route.page === 'event-detail') return <EventDetailPage eventId={route.param} user={user} authLoading={authLoading} />;
  if (route.page === 'replay') return <ReplayPage eventId={route.param} user={user} />;

  // Auth-required pages
  if (authLoading) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center"><div className="animate-pulse text-neutral-500 font-mono">LOADING...</div></div>;
  }

  if (!user && route.page === 'create-event') return <AuthGate onDone={() => {}} message="Sign in to create a watch party" />;
  if (!user && route.page === 'room') return <AuthGate onDone={() => {}} message="Sign in to join the watch party" />;

  if (route.page === 'create-event' && user) return <CreateEventPage user={user} />;
  if (route.page === 'room' && user) return <RoomView user={user} roomId={route.param} />;

  return <HomePage user={user} authLoading={authLoading} />;
}

// --- Public NavBar ---

function PublicNav({ user, transparent }: { user: User | null; transparent?: boolean }) {
  return (
    <nav className={cn("sticky top-0 z-40 border-b", transparent ? "bg-transparent border-transparent" : "bg-neutral-950/80 backdrop-blur-md border-neutral-800")}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate('home')} className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Video size={16} className="text-white" />
            </div>
            <span className="font-bold hidden sm:block">StreamParty</span>
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('events')} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">Events</button>
            <button onClick={() => navigate('create-event')} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors flex items-center gap-1"><Plus size={14} /> Create</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="text-xs text-neutral-500 hidden sm:block">{user.displayName || 'Guest'}</span>
              <button onClick={() => auth.signOut()} className="p-1.5 text-neutral-500 hover:text-white transition-colors" title="Logout"><LogOut size={16} /></button>
            </>
          ) : (
            <button onClick={() => navigate('create-event')} className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/15 rounded-lg transition-colors">Sign In</button>
          )}
        </div>
      </div>
    </nav>
  );
}

// --- Auth Gate (for protected pages) ---

function AuthGate({ onDone, message }: { onDone: () => void; message: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const google = async () => {
    setLoading(true); setError('');
    try { await signInWithPopup(auth, googleProvider); }
    catch (e: any) { setError(e?.code === 'auth/unauthorized-domain' ? 'Use Guest login on this domain.' : 'Google sign-in failed. Try Guest.'); }
    finally { setLoading(false); }
  };

  const emailAuth = async () => {
    if (!email || !password) { setError('Enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'signup') await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      const c = e?.code || '';
      if (c === 'auth/invalid-credential') setError('Invalid credentials. Try signing up.');
      else if (c === 'auth/email-already-in-use') setError('Email already in use.');
      else if (c === 'auth/weak-password') setError('Password must be 6+ chars.');
      else setError('Auth failed. Try Guest.');
    } finally { setLoading(false); }
  };

  const guest = async () => {
    setLoading(true); setError('');
    try { await signInAnonymously(auth); }
    catch { setError('Failed. Try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={null} />
      <div className="flex items-center justify-center p-6 pt-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-sm w-full space-y-5">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center mx-auto mb-4"><Video size={28} /></div>
            <h2 className="text-xl font-bold">{message}</h2>
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">{error}</div>}

          <button onClick={google} disabled={loading} className="w-full py-3 bg-white text-black font-semibold rounded-xl flex items-center justify-center gap-3 hover:bg-neutral-100 transition-colors disabled:opacity-60">
            {loading ? <Loader className="w-5 h-5 animate-spin" /> : <><img src="/google.svg" className="w-5 h-5" alt="" /> Sign in with Google</>}
          </button>

          <div className="flex items-center"><div className="flex-1 h-px bg-neutral-800" /><span className="px-3 text-xs text-neutral-600">or</span><div className="flex-1 h-px bg-neutral-800" /></div>

          <form onSubmit={(e) => { e.preventDefault(); emailAuth(); }} className="space-y-3">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
            <button type="submit" disabled={loading} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium text-sm transition-colors disabled:opacity-60">
              {mode === 'signup' ? 'Sign Up' : 'Sign In'}
            </button>
          </form>
          <div className="text-center text-xs text-neutral-500">
            {mode === 'signup' ? 'Have an account?' : 'No account?'}{' '}
            <button onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')} className="text-indigo-400 underline">{mode === 'signup' ? 'Sign In' : 'Sign Up'}</button>
          </div>

          <div className="flex items-center"><div className="flex-1 h-px bg-neutral-800" /><span className="px-3 text-xs text-neutral-600">or</span><div className="flex-1 h-px bg-neutral-800" /></div>

          <button onClick={guest} disabled={loading} className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg font-medium text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            <Users size={16} /> Continue as Guest
          </button>
        </motion.div>
      </div>
    </div>
  );
}

// =============================================
// PUBLIC PAGES - No login required
// =============================================

// --- Home Page ---

function HomePage({ user, authLoading }: { user: User | null; authLoading: boolean }) {
  const [events, setEvents] = useState<WatchPartyEvent[]>([]);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [subEmail, setSubEmail] = useState('');
  const [subName, setSubName] = useState('');
  const [subStatus, setSubStatus] = useState<'' | 'loading' | 'done' | 'error'>('');

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('scheduledAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const now = Date.now();
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as WatchPartyEvent)).filter(e => e.scheduledAt > now - 7200000));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'subscribers')), (snap) => setSubscriberCount(snap.size));
  }, []);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subEmail.includes('@')) return;
    setSubStatus('loading');
    try {
      const existing = await getDocs(query(collection(db, 'subscribers'), where('email', '==', subEmail.trim().toLowerCase())));
      if (existing.empty) {
        await addDoc(collection(db, 'subscribers'), { email: subEmail.trim().toLowerCase(), name: subName.trim(), subscribedAt: Date.now(), source: 'homepage' });
      }
      setSubStatus('done');
      setSubEmail(''); setSubName('');
    } catch { setSubStatus('error'); }
  };

  const liveEvents = events.filter(e => e.scheduledAt <= Date.now() && !e.endedAt);
  const upcomingEvents = events.filter(e => e.scheduledAt > Date.now());
  const replayEvents = events.filter(e => e.endedAt && isReplayAvailable(e));

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={user} />

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/15 via-purple-600/10 to-transparent" />
          {[...Array(15)].map((_, i) => (
            <motion.div key={i} className="absolute w-1 h-1 bg-indigo-400/30 rounded-full"
              animate={{ scale: [0, 1, 0], opacity: [0, 0.6, 0] }}
              transition={{ duration: 4, delay: i * 0.3, repeat: Infinity }}
              style={{ left: `${5 + Math.random() * 90}%`, top: `${10 + Math.random() * 80}%` }} />
          ))}
        </div>

        <div className="max-w-5xl mx-auto px-4 py-20 sm:py-28 relative z-10 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-6">
              <Tv size={14} /> Watch Parties by Don Matthews
            </div>
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
              Watch Together.<br />
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Experience Together.</span>
            </h1>
            <p className="text-neutral-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10">
              Join live watch parties with synchronized video, real-time chat, and reactions. Subscribe to never miss an event.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
              {liveEvents.length > 0 ? (
                <button onClick={() => navigate(liveEvents[0].roomId)}
                  className="px-8 py-4 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-lg transition-all shadow-lg shadow-red-600/30 hover:shadow-red-500/40 flex items-center gap-3 animate-pulse">
                  <span className="w-3 h-3 rounded-full bg-white animate-ping" />
                  Join Live Now — {liveEvents[0].title}
                </button>
              ) : upcomingEvents.length > 0 ? (
                <button onClick={() => navigate(`event/${upcomingEvents[0].id}`)}
                  className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40 flex items-center gap-3">
                  <Calendar size={20} /> Next Event — {upcomingEvents[0].title}
                </button>
              ) : (
                <button onClick={() => navigate('create-event')}
                  className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-3">
                  <Plus size={20} /> Create a Watch Party
                </button>
              )}
              <button onClick={() => navigate('events')}
                className="px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-medium transition-colors flex items-center gap-2">
                Browse Events <ChevronRight size={16} />
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Subscribe Section — Prominent, above the fold */}
      <div className="bg-gradient-to-r from-indigo-600/10 via-purple-600/10 to-indigo-600/10 border-y border-indigo-500/10">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Bell size={24} className="text-indigo-400" />
              <h2 className="text-2xl font-bold">Never Miss a Watch Party</h2>
            </div>
            <p className="text-neutral-400">Get notified when new events are scheduled. No spam, ever.</p>

            {subStatus === 'done' ? (
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                className="flex items-center justify-center gap-2 text-green-400 font-semibold py-3">
                <CheckCircle size={20} /> You're subscribed! We'll keep you posted.
              </motion.div>
            ) : (
              <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row items-stretch gap-2 max-w-lg mx-auto">
                <input type="text" value={subName} onChange={e => setSubName(e.target.value)}
                  placeholder="Your name" className="px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500 sm:w-36" />
                <input type="email" value={subEmail} onChange={e => setSubEmail(e.target.value)}
                  placeholder="Email address" required
                  className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
                <button type="submit" disabled={subStatus === 'loading'}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 whitespace-nowrap">
                  {subStatus === 'loading' ? <Loader className="w-4 h-4 animate-spin" /> : <><Mail size={16} /> Subscribe</>}
                </button>
              </form>
            )}

            {subscriberCount > 0 && (
              <p className="text-xs text-neutral-500 flex items-center justify-center gap-1">
                <Users size={12} /> {subscriberCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'} already signed up
              </p>
            )}
          </motion.div>
        </div>
      </div>

      {/* Live Now Banner */}
      {liveEvents.length > 0 && (
        <div className="bg-red-600/10 border-b border-red-500/20">
          <div className="max-w-6xl mx-auto px-4 py-6">
            {liveEvents.map(evt => (
              <button key={evt.id} onClick={() => navigate(evt.roomId)}
                className="w-full flex items-center justify-between gap-4 p-4 rounded-xl bg-red-600/10 border border-red-500/20 hover:bg-red-600/20 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <span className="w-4 h-4 rounded-full bg-red-500 block animate-pulse" />
                    <span className="absolute inset-0 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-50" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-0.5">🔴 Live Now</div>
                    <div className="font-bold text-lg">{evt.title}</div>
                  </div>
                </div>
                <div className="px-5 py-2.5 bg-red-600 group-hover:bg-red-500 rounded-lg font-bold transition-colors flex items-center gap-2">
                  <Play size={16} /> Join Now
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      <div className="max-w-6xl mx-auto px-4 py-14">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold flex items-center gap-3"><Calendar size={24} className="text-indigo-400" /> Upcoming Watch Parties</h2>
          <button onClick={() => navigate('events')} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1">View All <ChevronRight size={14} /></button>
        </div>

        {upcomingEvents.length === 0 && liveEvents.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center mx-auto"><Calendar size={32} className="text-neutral-700" /></div>
            <p className="text-neutral-500 text-lg">No upcoming events yet.</p>
            <button onClick={() => navigate('create-event')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition-colors">Create the First One</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {upcomingEvents.slice(0, 6).map((evt, i) => <EventCard key={evt.id} event={evt} index={i} />)}
          </div>
        )}
      </div>

      {/* Recent Replays */}
      {replayEvents.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 py-14 border-t border-neutral-800">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold flex items-center gap-3"><RotateCcw size={24} className="text-purple-400" /> Watch the Replay</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {replayEvents.slice(0, 3).map((evt, i) => <EventCard key={evt.id} event={evt} index={i} />)}
          </div>
        </div>
      )}

      {/* Quick Join */}
      <div className="border-t border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-5">
          <h3 className="text-xl font-bold">Have a Room Code?</h3>
          <p className="text-neutral-500 text-sm">Enter a code to join an existing watch party room.</p>
          <QuickRoomEntry />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-800 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-600">
          <span>StreamParty by Don Matthews</span>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('events')} className="hover:text-neutral-400 transition-colors">Events</button>
            <button onClick={() => navigate('create-event')} className="hover:text-neutral-400 transition-colors">Create Event</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function QuickRoomEntry() {
  const [code, setCode] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); navigate(code || generateId()); }} className="flex items-center gap-2 max-w-md mx-auto">
      <input type="text" value={code} onChange={e => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        placeholder="Room code (or leave blank for new)" className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
      <button type="submit" className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap">Join</button>
    </form>
  );
}

// --- Event Card ---

function EventCard({ event, index }: { key?: React.Key; event: WatchPartyEvent; index: number }) {
  const countdown = useCountdown(event.scheduledAt);
  const isLive = countdown.isLive && !event.endedAt;
  const hasReplay = isReplayAvailable(event);
  const isEnded = !!event.endedAt;
  const [rsvpCount, setRsvpCount] = useState(0);
  const [replayTimeLeft, setReplayTimeLeft] = useState('');

  useEffect(() => {
    return onSnapshot(query(collection(db, 'events', event.id, 'rsvps')), snap => setRsvpCount(snap.size));
  }, [event.id]);

  useEffect(() => {
    if (!hasReplay) return;
    const update = () => setReplayTimeLeft(formatDuration(replayExpiresAt(event) - Date.now()));
    update();
    const iv = setInterval(update, 60000);
    return () => clearInterval(iv);
  }, [hasReplay, event.endedAt]);

  const handleClick = () => {
    if (hasReplay) navigate(`replay/${event.id}`);
    else if (isLive) navigate(event.roomId);
    else navigate(`event/${event.id}`);
  };

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      whileHover={{ y: -4 }}
      onClick={handleClick}
      className={cn("text-left rounded-2xl border transition-all group relative overflow-hidden w-full",
        isLive ? "bg-red-600/5 border-red-500/20 hover:border-red-500/40"
        : hasReplay ? "bg-purple-600/5 border-purple-500/20 hover:border-purple-500/40"
        : "bg-neutral-900/50 border-neutral-800 hover:border-neutral-700"
      )}>
      {/* Top accent bar */}
      <div className={cn("h-1 w-full",
        isLive ? "bg-gradient-to-r from-red-600 to-orange-500"
        : hasReplay ? "bg-gradient-to-r from-purple-600 to-pink-500"
        : "bg-gradient-to-r from-indigo-600 to-purple-600")} />

      <div className="p-5 space-y-3">
        {/* Badge */}
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Live Now
          </span>
        ) : hasReplay ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold uppercase tracking-wider">
              <RotateCcw size={11} /> Replay Available
            </span>
            <span className="text-[10px] text-neutral-500">Expires in {replayTimeLeft}</span>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-medium">
            <Clock size={11} /> {formatDate(event.scheduledAt)} · {formatTime(event.scheduledAt)}
          </span>
        )}

        <h3 className="font-bold text-lg leading-tight">{event.title}</h3>
        {event.description && <p className="text-sm text-neutral-500 line-clamp-2">{event.description}</p>}

        {/* Countdown (only for upcoming) */}
        {!isLive && !isEnded && (
          <div className="flex items-center gap-3 py-2">
            {[
              { v: countdown.days, l: 'd' },
              { v: countdown.hours, l: 'h' },
              { v: countdown.minutes, l: 'm' },
              { v: countdown.seconds, l: 's' },
            ].map(u => (
              <div key={u.l} className="flex items-baseline gap-0.5">
                <span className="text-xl font-bold font-mono text-white">{String(u.v).padStart(2, '0')}</span>
                <span className="text-[10px] text-neutral-600 uppercase">{u.l}</span>
              </div>
            ))}
          </div>
        )}

        {/* Social proof row */}
        <div className="flex items-center gap-3 text-xs text-neutral-500 pt-1">
          {rsvpCount > 0 && (
            <span className="flex items-center gap-1"><UserPlus size={12} className="text-indigo-400" /> {rsvpCount} going</span>
          )}
          <span className="flex items-center gap-1">by {event.creatorName}</span>
        </div>

        {/* Action hint */}
        <div className={cn("mt-2 text-xs font-semibold flex items-center gap-1.5 transition-colors",
          isLive ? "text-red-400 group-hover:text-red-300"
          : hasReplay ? "text-purple-400 group-hover:text-purple-300"
          : "text-indigo-400 group-hover:text-indigo-300")}>
          {isLive ? <><Play size={12} /> Join the watch party</>
          : hasReplay ? <><RotateCcw size={12} /> Watch the replay</>
          : <><Eye size={12} /> View event & RSVP</>}
        </div>
      </div>
    </motion.button>
  );
}

// --- Events Page ---

function EventsPage({ user, authLoading }: { user: User | null; authLoading: boolean }) {
  const [events, setEvents] = useState<WatchPartyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('scheduledAt', 'asc'));
    return onSnapshot(q, snap => { setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as WatchPartyEvent))); setLoading(false); });
  }, []);

  const now = Date.now();
  const filtered = events.filter(e => {
    if (filter === 'upcoming') return e.scheduledAt > now && !e.endedAt;
    if (filter === 'past') return !!e.endedAt || e.scheduledAt <= now - 3600000;
    return true;
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={user} />
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Watch Parties</h1>
            <p className="text-neutral-500 mt-1">Browse events and join the fun — no account needed to look around.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-neutral-900 rounded-xl p-0.5">
              {(['upcoming', 'past', 'all'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn("px-4 py-2 text-xs font-medium rounded-lg transition-colors capitalize",
                    filter === f ? "bg-indigo-600 text-white" : "text-neutral-500 hover:text-white")}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={() => navigate('create-event')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5"><Plus size={14} /> New</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20"><Loader className="w-8 h-8 animate-spin mx-auto text-neutral-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Calendar size={48} className="mx-auto text-neutral-700" />
            <p className="text-neutral-500">{filter === 'upcoming' ? 'No upcoming events.' : 'Nothing here.'}</p>
            <button onClick={() => navigate('create-event')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition-colors">Create One</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((evt, i) => <EventCard key={evt.id} event={evt} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Event Detail Page (Public) ---

function EventDetailPage({ eventId, user, authLoading }: { eventId: string; user: User | null; authLoading: boolean }) {
  const [event, setEvent] = useState<WatchPartyEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [rsvpEmail, setRsvpEmail] = useState('');
  const [rsvpName, setRsvpName] = useState('');
  const [rsvpStatus, setRsvpStatus] = useState<'' | 'loading' | 'done' | 'error'>('');
  const [copied, setCopied] = useState('');
  const [showEmbed, setShowEmbed] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);

  useEffect(() => {
    return onSnapshot(doc(db, 'events', eventId), snap => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() } as WatchPartyEvent);
      setLoading(false);
    });
  }, [eventId]);

  useEffect(() => {
    return onSnapshot(query(collection(db, 'events', eventId, 'rsvps'), orderBy('createdAt', 'desc')), snap => {
      setRsvps(snap.docs.map(d => ({ id: d.id, ...d.data() } as RSVP)));
    });
  }, [eventId]);

  useEffect(() => {
    if (!event?.roomId) return;
    return onSnapshot(query(collection(db, 'rooms', event.roomId, 'presence')), snap => {
      setViewerCount(snap.docs.filter(d => Date.now() - (d.data().lastSeen || 0) < 60000).length);
    });
  }, [event?.roomId]);

  const countdown = useCountdown(event?.scheduledAt || Date.now() + 9e9);
  const isLive = event ? (event.scheduledAt <= Date.now() && !event.endedAt) : false;
  const hasReplay = event ? isReplayAvailable(event) : false;
  const isEnded = event ? !!event.endedAt : false;

  const eventUrl = `${BASE_URL}/#event/${eventId}`;
  const roomUrl = event ? `${BASE_URL}/#${event.roomId}` : '';

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 2000); };

  const handleRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rsvpEmail.includes('@')) return;
    setRsvpStatus('loading');
    try {
      const existing = await getDocs(query(collection(db, 'events', eventId, 'rsvps'), where('email', '==', rsvpEmail.trim().toLowerCase())));
      if (existing.empty) {
        await addDoc(collection(db, 'events', eventId, 'rsvps'), { email: rsvpEmail.trim().toLowerCase(), name: rsvpName.trim(), createdAt: Date.now() });
      }
      // Also add to global subscribers
      const existingSub = await getDocs(query(collection(db, 'subscribers'), where('email', '==', rsvpEmail.trim().toLowerCase())));
      if (existingSub.empty) {
        await addDoc(collection(db, 'subscribers'), { email: rsvpEmail.trim().toLowerCase(), name: rsvpName.trim(), subscribedAt: Date.now(), source: `event-${eventId}` });
      }
      setRsvpStatus('done'); setRsvpEmail(''); setRsvpName('');
    } catch { setRsvpStatus('error'); }
  };

  if (loading) return <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-neutral-600" /></div>;
  if (!event) return (
    <div className="min-h-screen bg-neutral-950 text-white"><PublicNav user={user} />
      <div className="flex items-center justify-center py-20"><p className="text-neutral-500">Event not found.</p></div>
    </div>
  );

  const isCreator = user && event.createdBy === user.uid;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={user} />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => navigate('events')} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-white mb-8 transition-colors">
          <ArrowLeft size={14} /> All Events
        </button>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* Header */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {isLive ? (
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-bold uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> Live Now
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/25 text-indigo-400 text-sm font-semibold">
                  <Clock size={14} /> {formatDateTime(event.scheduledAt)}
                </span>
              )}
              {viewerCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-800 text-neutral-300 text-sm">
                  <Eye size={14} className="text-green-400" /> {viewerCount} watching now
                </span>
              )}
              {rsvps.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-800 text-neutral-300 text-sm">
                  <UserPlus size={14} className="text-indigo-400" /> {rsvps.length} going
                </span>
              )}
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold leading-tight">{event.title}</h1>
            {event.description && <p className="text-neutral-400 text-lg leading-relaxed">{event.description}</p>}
            <p className="text-sm text-neutral-600">Hosted by {event.creatorName}</p>
          </div>

          {/* Countdown, Live CTA, or Replay CTA */}
          {hasReplay ? (
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="p-8 rounded-2xl bg-gradient-to-br from-purple-600/15 to-pink-600/10 border border-purple-500/20 text-center space-y-5">
              <div className="flex items-center justify-center gap-3">
                <RotateCcw size={24} className="text-purple-400" />
                <span className="text-2xl font-bold text-purple-400">Replay Available</span>
              </div>
              <p className="text-neutral-300">This watch party has ended. Watch the replay with full chat history.</p>
              <p className="text-sm text-neutral-500">Replay expires in {formatDuration(replayExpiresAt(event) - Date.now())}</p>
              <button onClick={() => navigate(`replay/${event.id}`)}
                className="px-10 py-4 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold text-xl transition-all shadow-lg shadow-purple-600/30 hover:shadow-purple-500/40 flex items-center justify-center gap-3 mx-auto">
                <RotateCcw size={22} /> Watch Replay
              </button>
            </motion.div>
          ) : isEnded ? (
            <div className="p-8 rounded-2xl bg-neutral-900 border border-neutral-800 text-center space-y-3">
              <p className="text-xl font-bold text-neutral-500">This Event Has Ended</p>
              <p className="text-sm text-neutral-600">The replay window has expired.</p>
            </div>
          ) : isLive ? (
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              className="p-8 rounded-2xl bg-gradient-to-br from-red-600/15 to-orange-600/10 border border-red-500/20 text-center space-y-5">
              <div className="flex items-center justify-center gap-3">
                <span className="w-4 h-4 rounded-full bg-red-500 animate-pulse" />
                <span className="text-2xl font-bold text-red-400">This Event is Live!</span>
              </div>
              <p className="text-neutral-300">The watch party is happening right now. Jump in.</p>
              <button onClick={() => navigate(event.roomId)}
                className="px-10 py-4 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-xl transition-all shadow-lg shadow-red-600/30 hover:shadow-red-500/40 flex items-center justify-center gap-3 mx-auto">
                <Play size={22} /> Join the Watch Party
              </button>
            </motion.div>
          ) : (
            <div className="p-8 rounded-2xl bg-gradient-to-br from-indigo-600/10 to-purple-600/10 border border-indigo-500/15 space-y-5">
              <p className="text-sm text-neutral-400 text-center uppercase tracking-wider font-medium">Starts In</p>
              <div className="flex items-center justify-center gap-4 sm:gap-8">
                {[
                  { label: 'Days', value: countdown.days },
                  { label: 'Hours', value: countdown.hours },
                  { label: 'Minutes', value: countdown.minutes },
                  { label: 'Seconds', value: countdown.seconds },
                ].map(u => (
                  <div key={u.label} className="text-center">
                    <div className="text-4xl sm:text-6xl font-bold font-mono bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent">
                      {String(u.value).padStart(2, '0')}
                    </div>
                    <div className="text-[10px] sm:text-xs text-neutral-500 uppercase tracking-wider mt-1">{u.label}</div>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <button onClick={() => navigate(event.roomId)}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors flex items-center gap-2 mx-auto">
                  <Play size={18} /> Enter Room Early
                </button>
              </div>
            </div>
          )}

          {/* ======== SHARE BUTTONS — Big & Prominent ======== */}
          <div className="p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 space-y-5">
            <h3 className="text-lg font-bold flex items-center gap-2"><Share2 size={20} className="text-indigo-400" /> Share This Event</h3>
            <p className="text-sm text-neutral-500">Help spread the word — the more the merrier!</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join me for "${event.title}" on StreamParty!\n${eventUrl}`)}`, '_blank')}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-[#1DA1F2]/10 hover:bg-[#1DA1F2]/20 border border-[#1DA1F2]/20 rounded-xl text-[#1DA1F2] font-medium text-sm transition-colors">
                <Globe size={18} /> Twitter
              </button>
              <button onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`, '_blank')}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-[#4267B2]/10 hover:bg-[#4267B2]/20 border border-[#4267B2]/20 rounded-xl text-[#4267B2] font-medium text-sm transition-colors">
                <Globe size={18} /> Facebook
              </button>
              <button onClick={() => copy(eventUrl, 'link')}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-medium text-sm transition-colors">
                <Copy size={18} /> {copied === 'link' ? '✓ Copied!' : 'Copy Link'}
              </button>
              <button onClick={() => setShowEmbed(!showEmbed)}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-medium text-sm transition-colors">
                <Code size={18} /> Embed
              </button>
            </div>

            {/* Direct Share URLs */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-xs text-neutral-500 whitespace-nowrap">Event:</span>
                <span className="text-xs text-neutral-300 truncate flex-1 font-mono">{eventUrl}</span>
                <button onClick={() => copy(eventUrl, 'event-url')} className="text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap">{copied === 'event-url' ? '✓' : 'Copy'}</button>
              </div>
              <div className="flex items-center gap-2 p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-xs text-neutral-500 whitespace-nowrap">Room:</span>
                <span className="text-xs text-neutral-300 truncate flex-1 font-mono">{roomUrl}</span>
                <button onClick={() => copy(roomUrl, 'room-url')} className="text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap">{copied === 'room-url' ? '✓' : 'Copy'}</button>
              </div>
            </div>

            {/* Embed Code */}
            <AnimatePresence>
              {showEmbed && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="space-y-2 pt-2">
                    <p className="text-xs text-neutral-500">Paste on any website to embed:</p>
                    <div className="relative">
                      <pre className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-green-400 overflow-x-auto font-mono">
{`<iframe
  src="${BASE_URL}/#${event.roomId}"
  width="100%" height="500"
  frameborder="0"
  allow="autoplay; fullscreen"
  style="border-radius:12px;border:1px solid #333">
</iframe>`}
                      </pre>
                      <button onClick={() => { copy(`<iframe src="${BASE_URL}/#${event.roomId}" width="100%" height="500" frameborder="0" allow="autoplay; fullscreen" style="border-radius:12px;border:1px solid #333"></iframe>`, 'embed'); }}
                        className="absolute top-3 right-3 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-xs transition-colors">{copied === 'embed' ? '✓ Copied!' : 'Copy Code'}</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ======== RSVP — Sign up in advance ======== */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-600/5 to-purple-600/5 border border-indigo-500/10 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2"><UserPlus size={20} className="text-indigo-400" /> RSVP — I'll Be There</h3>
              {rsvps.length > 0 && <span className="text-sm text-indigo-400 font-semibold">{rsvps.length} going</span>}
            </div>

            {rsvpStatus === 'done' ? (
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <CheckCircle size={24} className="text-green-400 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-400">You're on the list!</p>
                  <p className="text-sm text-neutral-400">We'll remind you when the party starts.</p>
                </div>
              </motion.div>
            ) : (
              <form onSubmit={handleRsvp} className="space-y-3">
                <p className="text-sm text-neutral-400">Reserve your spot and get a reminder. No account needed.</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="text" value={rsvpName} onChange={e => setRsvpName(e.target.value)} placeholder="Your name"
                    className="px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500 sm:w-40" />
                  <input type="email" value={rsvpEmail} onChange={e => setRsvpEmail(e.target.value)} placeholder="Email address" required
                    className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
                  <button type="submit" disabled={rsvpStatus === 'loading'}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 whitespace-nowrap">
                    {rsvpStatus === 'loading' ? <Loader className="w-4 h-4 animate-spin" /> : <><CheckCircle size={16} /> RSVP</>}
                  </button>
                </div>
                {rsvpStatus === 'error' && <p className="text-sm text-red-400">Something went wrong. Try again.</p>}
              </form>
            )}

            {/* RSVP names as social proof */}
            {rsvps.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {rsvps.slice(0, 12).map(r => (
                  <span key={r.id} className="px-2.5 py-1 bg-neutral-800 rounded-full text-xs text-neutral-300">
                    {r.name || r.email.split('@')[0]}
                  </span>
                ))}
                {rsvps.length > 12 && <span className="text-xs text-neutral-500">+{rsvps.length - 12} more</span>}
              </div>
            )}
          </div>

          {/* Admin controls */}
          {isCreator && (
            <div className="pt-4 border-t border-neutral-800 flex items-center gap-4">
              <button onClick={async () => { if (confirm('Delete this event?')) { await deleteDoc(doc(db, 'events', eventId)); navigate('events'); } }}
                className="text-sm text-red-500 hover:text-red-400 flex items-center gap-1.5 transition-colors"><Trash2 size={14} /> Delete Event</button>
              <ExportSubscribers eventId={eventId} rsvps={rsvps} />
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

// --- Export Subscribers ---

function ExportSubscribers({ eventId, rsvps }: { eventId: string; rsvps: RSVP[] }) {
  const exportCSV = () => {
    const rows = [['Name', 'Email', 'RSVP Date']];
    rsvps.forEach(r => rows.push([r.name, r.email, new Date(r.createdAt).toISOString()]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `rsvps-${eventId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button onClick={exportCSV} className="text-sm text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5 transition-colors">
      <Download size={14} /> Export RSVPs ({rsvps.length})
    </button>
  );
}

// --- Replay Page (Public — no login required) ---

function ReplayPage({ eventId, user }: { eventId: string; user: User | null }) {
  const [event, setEvent] = useState<WatchPartyEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [replayTimeLeft, setReplayTimeLeft] = useState('');
  const [copied, setCopied] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'events', eventId), snap => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() } as WatchPartyEvent);
      setLoading(false);
    });
  }, [eventId]);

  // Load all chat messages from the room
  useEffect(() => {
    if (!event?.roomId) return;
    const q = query(collection(db, 'rooms', event.roomId, 'messages'), orderBy('timestamp', 'asc'));
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)));
    });
  }, [event?.roomId]);

  // Resolve video URL (VK or direct)
  useEffect(() => {
    if (!event?.videoUrl) return;
    if (event.videoUrl.startsWith('https://vk.com/video')) {
      setVideoLoading(true);
      getVkVideoMp4Url(event.videoUrl, (import.meta as any).env.VITE_VK_TOKEN || '')
        .then(u => setVideoUrl(u)).catch(() => setVideoUrl('')).finally(() => setVideoLoading(false));
    } else {
      setVideoUrl(event.videoUrl);
    }
  }, [event?.videoUrl]);

  // Replay expiry timer
  useEffect(() => {
    if (!event?.endedAt) return;
    const update = () => setReplayTimeLeft(formatDuration(replayExpiresAt(event) - Date.now()));
    update();
    const iv = setInterval(update, 60000);
    return () => clearInterval(iv);
  }, [event?.endedAt]);

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 2000); };
  const replayUrl = `${BASE_URL}/#replay/${eventId}`;

  if (loading) return <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center"><Loader className="w-8 h-8 animate-spin text-neutral-600" /></div>;

  if (!event) return (
    <div className="min-h-screen bg-neutral-950 text-white"><PublicNav user={user} />
      <div className="flex items-center justify-center py-20"><p className="text-neutral-500">Event not found.</p></div>
    </div>
  );

  // Check if replay expired
  if (!isReplayAvailable(event)) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <PublicNav user={user} />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center mx-auto"><RotateCcw size={32} className="text-neutral-700" /></div>
          <h1 className="text-2xl font-bold">Replay Expired</h1>
          <p className="text-neutral-500">The 72-hour replay window for "{event.title}" has passed.</p>
          <button onClick={() => navigate('events')} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition-colors">Browse Events</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={user} />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <button onClick={() => navigate(`event/${eventId}`)} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-white mb-6 transition-colors">
          <ArrowLeft size={14} /> Event Details
        </button>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-bold uppercase tracking-wider">
                  <RotateCcw size={12} /> Replay
                </span>
                <span className="text-xs text-neutral-500">Expires in {replayTimeLeft}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold">{event.title}</h1>
              <p className="text-sm text-neutral-500 mt-1">Hosted by {event.creatorName} · {formatDateTime(event.scheduledAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Watch the replay of "${event.title}" on StreamParty!\n${replayUrl}`)}`, '_blank')}
                className="px-3 py-2 bg-[#1DA1F2]/10 hover:bg-[#1DA1F2]/20 border border-[#1DA1F2]/20 rounded-lg text-[#1DA1F2] text-xs font-medium transition-colors flex items-center gap-1.5"><Globe size={14} /> Share</button>
              <button onClick={() => copy(replayUrl, 'link')}
                className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5">
                <Copy size={14} /> {copied === 'link' ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>

          {/* Main content — Video + Chat side by side */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Video Player */}
            <div className="flex-1">
              <div className="bg-black rounded-2xl overflow-hidden border border-neutral-800 relative aspect-video">
                {videoUrl ? (
                  <>
                    <video ref={videoRef} src={videoUrl} controls className="w-full h-full object-contain"
                      onLoadStart={() => setVideoLoading(true)} onLoadedData={() => setVideoLoading(false)} />
                    {videoLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-500 border-t-transparent" /></div>}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-700 font-mono text-sm">VIDEO UNAVAILABLE</div>
                )}
              </div>
              {event.description && (
                <div className="mt-4 p-4 bg-neutral-900/50 rounded-xl border border-neutral-800">
                  <p className="text-sm text-neutral-400">{event.description}</p>
                </div>
              )}
            </div>

            {/* Chat History */}
            <div className="lg:w-96 flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/50 overflow-hidden" style={{ maxHeight: 'calc(56.25vw + 100px)', minHeight: '400px' }}>
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <MessageCircle size={16} className="text-purple-400" /> Chat History
                </span>
                <span className="text-xs text-neutral-500">{messages.length} messages</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-600 gap-2">
                    <MessageCircle size={32} strokeWidth={1} />
                    <p className="text-xs font-mono">NO CHAT MESSAGES</p>
                  </div>
                ) : messages.map(m => (
                  <div key={m.id} className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {m.userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-neutral-500">{m.userName} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-neutral-800 text-sm break-words">{m.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-neutral-800 text-center">
                <p className="text-[10px] text-neutral-600 uppercase tracking-wider">Read-only replay · Chat is closed</p>
              </div>
            </div>
          </div>

          {/* Expiry notice */}
          <div className="p-4 rounded-xl bg-purple-600/5 border border-purple-500/10 flex items-center gap-3 text-sm text-neutral-400">
            <Clock size={16} className="text-purple-400 flex-shrink-0" />
            <span>This replay will be publicly available for <strong className="text-white">{replayTimeLeft}</strong> more. After that, it will be removed.</span>
          </div>
        </motion.div>
      </div>
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
    if (!title.trim()) { setError('Title required.'); return; }
    if (!date || !time) { setError('Pick date and time.'); return; }
    const scheduledAt = new Date(`${date}T${time}`).getTime();
    if (scheduledAt < Date.now()) { setError('Must be in the future.'); return; }

    setCreating(true); setError('');
    try {
      const eventId = generateEventId();
      const roomId = `party-${generateId()}`;
      await setDoc(doc(db, 'events', eventId), {
        title: title.trim(), description: description.trim(),
        videoUrl: videoUrl.trim() || DEFAULT_VIDEOS[0].url,
        scheduledAt, createdAt: Date.now(), createdBy: user.uid,
        creatorName: user.displayName || 'Anonymous', roomId, status: 'upcoming'
      });
      await setDoc(doc(db, 'rooms', roomId), {
        videoUrl: videoUrl.trim() || DEFAULT_VIDEOS[0].url,
        status: 'paused', currentTime: 0, lastUpdated: Date.now(), hostId: user.uid
      });
      navigate(`event/${eventId}`);
    } catch { setError('Failed to create event.'); }
    finally { setCreating(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <PublicNav user={user} />
      <div className="max-w-2xl mx-auto px-4 py-10">
        <button onClick={() => navigate('events')} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-white mb-6 transition-colors"><ArrowLeft size={14} /> Back</button>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-2">Schedule a Watch Party</h1>
          <p className="text-neutral-500 mb-8">Create an event page with countdown, RSVP, and shareable links.</p>

          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-xl mb-6">{error}</div>}

          <form onSubmit={handleCreate} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2">Event Title *</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Friday Night Movie Party"
                className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" maxLength={100} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What are we watching and why should people join?" rows={3}
                className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500 resize-none" maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Date *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Time *</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Video URL</label>
              <input type="url" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://... (optional, blank = demo video)"
                className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-neutral-500" />
              <p className="text-xs text-neutral-600 mt-1">Supports MP4 links and VK video URLs</p>
            </div>
            <button type="submit" disabled={creating}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-3">
              {creating ? <><Loader className="w-5 h-5 animate-spin" /> Creating...</> : <><Calendar size={20} /> Create Watch Party</>}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

// =============================================
// ROOM VIEW — Requires auth
// =============================================

function RoomView({ user, roomId }: { user: User; roomId: string }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [actualVideoUrl, setActualVideoUrl] = useState('');
  const [vkUrl, setVkUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const syncIgnoreRef = useRef(false);
  const presenceRef = useRef<any>(null);

  const ROOM_ID = roomId;

  const copyLink = () => { navigator.clipboard.writeText(`${BASE_URL}/#${ROOM_ID}`); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // Room state sync
  useEffect(() => {
    const roomRef = doc(db, 'rooms', ROOM_ID);
    return onSnapshot(roomRef, snap => {
      if (snap.exists()) {
        const data = snap.data() as RoomState;
        const newIsHost = data.hostId === user.uid;
        setRoomState(data); setIsHost(newIsHost); setError(null);
        if (videoRef.current && !syncIgnoreRef.current) {
          const v = videoRef.current;
          const diff = Math.abs(v.currentTime - data.currentTime);
          if (!newIsHost || Date.now() - data.lastUpdated < 5000) {
            if (diff > 1 || (data.status === 'playing' && v.paused) || (data.status === 'paused' && !v.paused)) {
              setTimeout(() => { if (videoRef.current && !syncIgnoreRef.current) { videoRef.current.currentTime = data.currentTime; data.status === 'playing' ? videoRef.current.play().catch(() => {}) : videoRef.current.pause(); } }, 100);
            }
          }
        }
      } else {
        setDoc(roomRef, { videoUrl: DEFAULT_VIDEOS[0].url, status: 'paused', currentTime: 0, lastUpdated: Date.now(), hostId: user.uid }).catch(() => setError('Failed to init room.'));
      }
    }, () => setError('Lost connection.'));
  }, [user, isHost, ROOM_ID]);

  // Auto-claim host
  useEffect(() => {
    if (!user || !roomState || isHost) return;
    if (!onlineUsers.some(u => u.uid === roomState.hostId) && onlineUsers.length > 0) {
      updateRoom({ hostId: user.uid });
    }
  }, [user, roomState, isHost, onlineUsers]);

  // VK video
  useEffect(() => {
    if (!roomState?.videoUrl) { setActualVideoUrl(''); return; }
    if (roomState.videoUrl.startsWith('https://vk.com/video')) {
      setVideoLoading(true);
      getVkVideoMp4Url(roomState.videoUrl, (import.meta as any).env.VITE_VK_TOKEN || '')
        .then(u => setActualVideoUrl(u)).catch(() => { setError('Failed to load VK video.'); setActualVideoUrl(''); }).finally(() => setVideoLoading(false));
    } else { setActualVideoUrl(roomState.videoUrl); }
  }, [roomState?.videoUrl]);

  // Chat
  useEffect(() => {
    const q = query(collection(db, 'rooms', ROOM_ID, 'messages'), orderBy('timestamp', 'desc'), limit(50));
    return onSnapshot(q, snap => { setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)).reverse()); });
  }, [ROOM_ID]);

  // Reactions
  useEffect(() => {
    const q = query(collection(db, 'rooms', ROOM_ID, 'reactions'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, snap => { const now = Date.now(); setReactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reaction)).filter(r => now - r.timestamp < 5000)); });
  }, [ROOM_ID]);

  // Presence
  useEffect(() => {
    const ref = doc(db, 'rooms', ROOM_ID, 'presence', user.uid);
    presenceRef.current = { uid: user.uid, displayName: user.displayName || 'Anonymous', lastSeen: Date.now(), isOnline: true };
    const up = () => setDoc(ref, { ...presenceRef.current, lastSeen: Date.now() }, { merge: true });
    up();
    const evts = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    evts.forEach(e => document.addEventListener(e, up, { passive: true }));
    const hb = setInterval(up, 30000);
    const unsub = onSnapshot(query(collection(db, 'rooms', ROOM_ID, 'presence')), snap => {
      const now = Date.now(); setOnlineUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserPresence)).filter(u => now - u.lastSeen < 60000));
    });
    const cleanup = () => setDoc(ref, { ...presenceRef.current, isOnline: false, lastSeen: Date.now() }, { merge: true });
    window.addEventListener('beforeunload', cleanup);
    return () => { cleanup(); clearInterval(hb); evts.forEach(e => document.removeEventListener(e, up)); window.removeEventListener('beforeunload', cleanup); unsub(); };
  }, [user, ROOM_ID]);

  // Host time sync
  useEffect(() => {
    if (!isHost || roomState?.status !== 'playing') return;
    const iv = setInterval(() => {
      if (videoRef.current && !syncIgnoreRef.current && roomState && Math.abs(videoRef.current.currentTime - roomState.currentTime) > 0.5) {
        updateRoom({ currentTime: videoRef.current.currentTime });
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [isHost, roomState?.status, roomState?.currentTime]);

  const updateRoom = async (u: Partial<RoomState>) => {
    if (!roomState) return;
    await setDoc(doc(db, 'rooms', ROOM_ID), { ...roomState, ...u, lastUpdated: Date.now() }, { merge: true });
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    syncIgnoreRef.current = true;
    const s = videoRef.current.paused ? 'playing' : 'paused';
    updateRoom({ status: s, currentTime: videoRef.current.currentTime, hostId: user.uid });
    s === 'playing' ? videoRef.current.play().catch(() => {}) : videoRef.current.pause();
    setTimeout(() => { syncIgnoreRef.current = false; }, 500);
  };

  const sendMsg = async (text: string) => {
    if (!text.trim()) return;
    const tid = `t-${Date.now()}`;
    setMessages(p => [...p, { id: tid, userId: user.uid, userName: user.displayName || 'Anonymous', text, timestamp: Date.now(), status: 'sending' }]);
    try { await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), { roomId: ROOM_ID, userId: user.uid, userName: user.displayName || 'Anonymous', text, timestamp: Date.now() }); }
    catch { setMessages(p => p.filter(m => m.id !== tid)); }
  };

  const react = async (emoji: string) => {
    try { if (navigator.vibrate) navigator.vibrate(50); await addDoc(collection(db, 'rooms', ROOM_ID, 'reactions'), { roomId: ROOM_ID, userId: user.uid, emoji, timestamp: Date.now() }); } catch {}
  };

  const endParty = async () => {
    if (!confirm('End this watch party? A public replay will be available for 72 hours.')) return;
    try {
      // Find event linked to this room
      const eventsSnap = await getDocs(query(collection(db, 'events'), where('roomId', '==', ROOM_ID)));
      for (const eventDoc of eventsSnap.docs) {
        await setDoc(doc(db, 'events', eventDoc.id), { status: 'ended', endedAt: Date.now() }, { merge: true });
        navigate(`event/${eventDoc.id}`);
        return;
      }
      // No event found, just go home
      navigate('home');
    } catch { setError('Failed to end party.'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col lg:flex-row overflow-hidden bg-neutral-950 text-white">
      <main className="flex-1 flex flex-col relative min-h-0">
        {/* Header */}
        <header className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('home')} className="w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center transition-colors"><Video size={18} /></button>
            <div>
              <h2 className="font-bold text-sm">StreamParty</h2>
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Room: {ROOM_ID}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={copyLink} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/30 transition-colors text-xs font-medium">
              {copied ? <><Copy size={12} /> Copied!</> : <><Share2 size={12} /> Share Room</>}
            </button>
            {isHost && (
              <button onClick={endParty} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 transition-colors text-xs font-medium">
                <StopCircle size={12} /> End Party
              </button>
            )}
            <button onClick={() => navigate('events')} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition-colors text-xs font-medium"><Calendar size={12} /> Events</button>
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs">
              <Users size={13} className="text-neutral-500" /> {onlineUsers.length}
            </div>
            <button onClick={() => setShowChat(!showChat)}
              className={cn("p-2 rounded-lg transition-colors relative", showChat ? "bg-indigo-600/20 text-indigo-400" : "text-neutral-500 hover:text-white")}>
              <MessageCircle size={20} />
              {messages.length > 0 && !showChat && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />}
            </button>
            <button onClick={() => auth.signOut()} className="p-2 text-neutral-500 hover:text-white transition-colors"><LogOut size={18} /></button>
          </div>
        </header>

        {error && <div className="bg-red-600/90 text-white px-4 py-2 text-sm flex items-center justify-between"><span>{error}</span><button onClick={() => setError(null)} className="ml-4">✕</button></div>}

        {/* Video */}
        <div className="flex-1 bg-black relative group flex items-center justify-center overflow-hidden">
          {roomState?.videoUrl ? (
            <>
              <video ref={videoRef} src={actualVideoUrl} className="w-full h-full object-contain"
                onPlay={() => { if (syncIgnoreRef.current || !isHost) return; updateRoom({ status: 'playing' }); }}
                onPause={() => { if (syncIgnoreRef.current || !isHost) return; updateRoom({ status: 'paused' }); }}
                onSeeked={() => { if (syncIgnoreRef.current || !isHost) return; updateRoom({ currentTime: videoRef.current?.currentTime || 0 }); }}
                controls={false} onLoadedData={() => setVideoLoading(false)} onLoadStart={() => setVideoLoading(true)} />
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute inset-0 flex items-center justify-center">
                  <button onClick={togglePlay} className="p-4 rounded-full bg-black/60 backdrop-blur-md border border-white/20 hover:bg-black/80 transition-all cursor-pointer hover:scale-110 active:scale-95">
                    {roomState?.status === 'playing' ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center gap-4">
                    <div className="flex-1"><div className="w-full h-1 bg-white/20 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: videoRef.current ? `${(videoRef.current.currentTime / (videoRef.current.duration || 1)) * 100}%` : '0%' }} /></div></div>
                    <div className="text-xs font-mono text-neutral-300">{videoRef.current ? `${Math.floor(videoRef.current.currentTime / 60)}:${(videoRef.current.currentTime % 60).toFixed(0).padStart(2, '0')}` : '0:00'}</div>
                  </div>
                </div>
              </div>
            </>
          ) : <div className="text-neutral-700 font-mono text-sm">NO VIDEO</div>}
          {videoLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-500 border-t-transparent" /></div>}
          <div className="absolute inset-0 pointer-events-none overflow-hidden"><AnimatePresence>{reactions.map(r => <FloatingEmoji key={r.id} emoji={r.emoji} />)}</AnimatePresence></div>
          {!isHost && roomState && <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Watching with Host</div>}
        </div>

        {/* Bottom Controls */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/30">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">Video Library</h3>
              <label className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg cursor-pointer text-xs font-medium transition-colors">
                <Upload size={14} /> Upload
                <input type="file" className="hidden" accept="video/*" onChange={e => { const f = e.target.files?.[0]; if (f) updateRoom({ videoUrl: URL.createObjectURL(f), currentTime: 0, status: 'paused', hostId: user.uid }); }} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {DEFAULT_VIDEOS.map(v => (
                <button key={v.url} onClick={() => updateRoom({ videoUrl: v.url, currentTime: 0, status: 'paused', hostId: user.uid })}
                  className={cn("p-3 rounded-xl border text-left transition-all", roomState?.videoUrl === v.url ? "bg-indigo-600/10 border-indigo-500/30" : "bg-neutral-900 border-neutral-800 hover:border-neutral-700")}>
                  <div className="text-sm font-bold truncate">{v.name}</div>
                  <div className="text-[10px] text-neutral-500 mt-1">Public Library</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="url" placeholder="VK video URL" value={vkUrl} onChange={e => setVkUrl(e.target.value)}
                className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={() => { if (vkUrl) { updateRoom({ videoUrl: vkUrl, currentTime: 0, status: 'paused', hostId: user.uid }); setVkUrl(''); } }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors">Load</button>
            </div>
            {/* Share row */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-800">
              <span className="text-xs text-neutral-600">Share:</span>
              <button onClick={copyLink} className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5"><Copy size={12} /> {copied ? 'Copied!' : 'Link'}</button>
              <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Watching on StreamParty! ${BASE_URL}/#${ROOM_ID}`)}`, '_blank')}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5"><Globe size={12} /> Twitter</button>
              <button onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${BASE_URL}/#${ROOM_ID}`)}`, '_blank')}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs transition-colors flex items-center gap-1.5"><Globe size={12} /> Facebook</button>
            </div>
          </div>
        </div>
      </main>

      {/* Chat */}
      <AnimatePresence>
        {showChat && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowChat(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showChat && (
          <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed lg:relative top-0 right-0 z-50 w-full sm:w-96 h-full border-l border-neutral-800 flex flex-col bg-neutral-950">
            <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2"><MessageCircle size={16} className="text-indigo-400" /> Chat <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full text-neutral-500">{onlineUsers.length} online</span></span>
              <button onClick={() => setShowChat(false)} className="p-1.5 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"><X size={18} /></button>
            </div>
            <div className="p-3 border-b border-neutral-800 flex items-center justify-around">
              {REACTION_EMOJIS.map(em => (
                <button key={em.label} onClick={() => react(em.label)} className="p-2 rounded-full hover:bg-neutral-900 transition-all"><em.icon className={cn("w-5 h-5", em.color)} /></button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 gap-2"><Smile size={32} strokeWidth={1} /><p className="text-xs font-mono">NO MESSAGES YET</p></div>
              ) : messages.map(m => {
                const own = m.userId === user.uid;
                return (
                  <div key={m.id} className={cn("flex gap-2.5 max-w-[85%]", own && "ml-auto flex-row-reverse")}>
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0", own ? "bg-indigo-600" : "bg-neutral-700")}>{m.userName.charAt(0).toUpperCase()}</div>
                    <div className={cn("flex flex-col gap-0.5", own ? "items-end" : "items-start")}>
                      <span className="text-[10px] text-neutral-500">{own ? 'You' : m.userName} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <div className={cn("px-3 py-2 rounded-2xl text-sm break-words", own ? "bg-indigo-600 rounded-br-md" : "bg-neutral-800 rounded-bl-md")}>{m.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t border-neutral-800"><ChatInput onSend={sendMsg} /></div>
          </motion.aside>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Shared Components ---

function ChatInput({ onSend }: { onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }} className="relative">
      <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Say something..."
        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 placeholder-neutral-600" maxLength={500} />
      <button type="submit" disabled={!text.trim()} className={cn("absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all", text.trim() ? "text-indigo-500 hover:text-indigo-400" : "text-neutral-700 cursor-not-allowed")}><Send size={18} /></button>
    </form>
  );
}

function FloatingEmoji({ emoji }: { key?: React.Key; emoji: string }) {
  const rx = useMemo(() => Math.random() * 80 + 10, []);
  const rd = useMemo(() => 3 + Math.random() * 2, []);
  const rs = useMemo(() => 0.6 + Math.random() * 0.8, []);
  const rr = useMemo(() => Math.random() * 60 - 30, []);
  return (
    <motion.div
      initial={{ y: '100%', x: `${rx}%`, opacity: 0, scale: 0 }}
      animate={{ y: '-20%', opacity: [0, 1, 1, 0.8, 0], scale: [0, rs, rs * 1.2, rs], rotate: [0, rr, rr * 0.5, 0], x: [`${rx}%`, `${rx + Math.random() * 30 - 15}%`] }}
      exit={{ opacity: 0, scale: 0 }} transition={{ duration: rd, ease: [0.25, 0.46, 0.45, 0.94], times: [0, 0.2, 0.8, 1] }}
      className="absolute bottom-0 text-4xl select-none pointer-events-none z-50">{emoji}</motion.div>
  );
}
