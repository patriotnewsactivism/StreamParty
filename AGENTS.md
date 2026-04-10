# AGENTS.md - StreamParty Development Guidelines

This document provides guidelines for agentic coding assistants working on the StreamParty codebase.

## Overview

StreamParty is a React-based video watching platform that enables real-time synchronized video playback with chat and reactions. Built with React 19, TypeScript, Vite, Firebase, and Tailwind CSS.

## Build/Lint/Test Commands

### Development
```bash
npm run dev          # Start development server on port 3000
npm run build        # Build for production
npm run preview      # Preview production build
npm run clean        # Clean dist directory
```

### Code Quality
```bash
npm run lint         # TypeScript type checking only (tsc --noEmit)
```

### Testing
**Note:** No test framework is currently configured. When adding tests:
- Use Vitest for unit/integration tests
- Use React Testing Library for component testing
- Run tests with: `npm run test` (to be configured)

### Running Individual Tests
**Note:** Configure testing framework first, then use:
```bash
npm run test -- <test-file-pattern>  # Run specific test file
npm run test -- --run               # Run tests once (no watch mode)
```

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2022
- JSX: react-jsx
- Module resolution: bundler
- Strict type checking enabled
- NoEmit mode for type checking only

### Import Organization
```typescript
// 1. React imports
import React, { useEffect, useState } from 'react';

// 2. External libraries (alphabetically sorted)
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';

// 3. Local imports
import { cn } from './lib/utils';
import { auth, db } from './firebase';
```

### Component Structure
```typescript
// --- Types ---

interface ComponentProps {
  // Props with explicit typing
}

// --- Constants ---

const CONSTANT_NAME = 'value';

// --- Component ---

export default function ComponentName({ prop }: ComponentProps) {
  // Hooks at the top
  const [state, setState] = useState(initialValue);

  // Effects in logical order
  useEffect(() => {
    // Side effects
  }, [dependencies]);

  // Event handlers
  const handleEvent = () => {
    // Handler logic
  };

  // Render
  return (
    // JSX
  );
}
```

### Naming Conventions

#### Components & Files
- **Components**: PascalCase (e.g., `ChatInput`, `VideoPlayer`)
- **Files**: PascalCase for components, camelCase for utilities
- **Hooks**: camelCase with `use` prefix (e.g., `useVideoSync`)

#### Variables & Functions
- **Variables**: camelCase (e.g., `videoUrl`, `isPlaying`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_VIDEOS`, `ROOM_ID`)
- **Functions**: camelCase (e.g., `handleVideoAction`, `sendMessage`)

#### Types & Interfaces
- **Interfaces**: PascalCase with descriptive names (e.g., `RoomState`, `ChatMessage`)
- **Types**: PascalCase (e.g., `VideoStatus`)
- **Generic types**: Single letter (e.g., `T`, `K`)

### TypeScript Best Practices

#### Interface Design
```typescript
interface User {
  id: string;
  name: string;
  email?: string; // Optional properties
}

interface VideoState {
  url: string;
  status: 'playing' | 'paused' | 'loading'; // Union types for enums
  currentTime: number;
}
```

#### Function Signatures
```typescript
// Explicit return types for complex functions
function calculateProgress(current: number, total: number): number {
  return (current / total) * 100;
}

// Void for side effects
function updateVideoState(updates: Partial<VideoState>): void {
  // Implementation
}

// Async functions with Promise types
async function fetchUserData(userId: string): Promise<User> {
  const response = await fetch(`/api/users/${userId}`);
  return response.json();
}
```

### React Patterns

#### Hooks Usage
```typescript
// Custom hooks for reusable logic
function useVideoSync(videoRef: RefObject<HTMLVideoElement>) {
  const [syncState, setSyncState] = useState<SyncState>({});

  useEffect(() => {
    // Sync logic
  }, []);

  return syncState;
}

// Effect dependencies
useEffect(() => {
  if (!user) return; // Early return for conditional effects

  const unsubscribe = onSnapshot(query, (snapshot) => {
    // Handle updates
  });

  return unsubscribe; // Cleanup function
}, [user]); // Explicit dependencies
```

#### Component Props
```typescript
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
  disabled?: boolean;
}

function Button({ children, variant = 'primary', onClick, disabled }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'base-styles',
        {
          'primary-styles': variant === 'primary',
          'secondary-styles': variant === 'secondary',
          'disabled-styles': disabled,
        }
      )}
    >
      {children}
    </button>
  );
}
```

### Styling with Tailwind CSS

#### Utility Function Usage
```typescript
import { cn } from './lib/utils';

// Always use cn() for conditional classes
<div className={cn(
  "base-classes",
  isActive && "active-classes",
  variant === 'large' && "large-classes"
)}>
```

#### Responsive Design
```typescript
// Mobile-first approach
<div className="flex flex-col lg:flex-row">
// Use Tailwind's responsive prefixes: sm:, md:, lg:, xl:
<div className="w-full md:w-1/2 lg:w-1/3">
```

#### Dark Theme (Current Setup)
- Background: `bg-neutral-950` (dark)
- Text: `text-white` primary, `text-neutral-400` secondary
- Borders: `border-neutral-800`
- Interactive elements: `hover:bg-neutral-900`

### Firebase Integration

#### Firestore Operations
```typescript
// Document references
const roomRef = doc(db, 'rooms', roomId);

// Queries with proper typing
const messagesQuery = query(
  collection(db, 'rooms', roomId, 'messages'),
  orderBy('timestamp', 'desc'),
  limit(50)
);

// Real-time listeners
useEffect(() => {
  const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ChatMessage[];
    setMessages(messages);
  });

  return unsubscribe;
}, []);
```

#### Error Handling
```typescript
try {
  await setDoc(roomRef, roomData);
} catch (error) {
  console.error('Failed to update room:', error);
  // Handle error appropriately
}
```

### Async/Await Patterns
```typescript
// Async event handlers
const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault();
  setLoading(true);

  try {
    await sendMessage(text);
    setText('');
  } catch (error) {
    console.error('Failed to send message:', error);
  } finally {
    setLoading(false);
  }
};
```

### File Organization

#### Directory Structure
```
src/
├── App.tsx           # Main app component
├── main.tsx          # Entry point
├── firebase.ts       # Firebase configuration and exports
├── index.css         # Global styles
└── lib/
    └── utils.ts      # Utility functions (cn, etc.)
```

#### Component Organization
- Keep components focused and single-responsibility
- Extract custom hooks for complex logic
- Use barrel exports for cleaner imports

### Code Comments

#### When to Comment
```typescript
// --- Types ---           // Section separators
// --- Constants ---
// --- Component ---

// Complex business logic
const calculateSyncOffset = (serverTime: number, clientTime: number): number => {
  // Adjust for network latency and clock skew
  return Math.abs(serverTime - clientTime);
};

// TODO: Implement video quality selection
// FIXME: Handle network disconnections gracefully
```

#### JSDoc for Complex Functions
```typescript
/**
 * Synchronizes video playback across all connected clients
 * @param currentTime - Current playback position in seconds
 * @param isPlaying - Whether video should be playing
 */
function syncPlayback(currentTime: number, isPlaying: boolean): void {
  // Implementation
}
```

### Error Handling

#### Firebase Errors
```typescript
try {
  await signInWithPopup(auth, provider);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('auth/popup-closed-by-user')) {
      // Handle user cancellation
    } else {
      console.error('Authentication failed:', error.message);
    }
  }
}
```

#### Network Requests
```typescript
const fetchWithRetry = async (url: string, retries = 3): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
};
```

### Performance Considerations

#### React Optimization
- Use `useMemo` for expensive calculations
- Use `useCallback` for event handlers passed as props
- Memoize components when appropriate: `React.memo(Component)`

#### Firebase Optimization
- Use appropriate query limits
- Implement pagination for large datasets
- Clean up listeners in useEffect return functions

### Security Best Practices

#### Environment Variables
- Never commit secrets to repository
- Use `.env.local` for local development
- Access via `import.meta.env` in Vite

#### Firebase Security
- Validate data before sending to Firestore
- Use Firebase security rules appropriately
- Handle authentication state properly

### Development Workflow

#### Git Commit Messages
```
feat: add video synchronization feature
fix: resolve chat message ordering bug
refactor: extract video controls into separate component
docs: update AGENTS.md with new guidelines
```

#### Pull Request Guidelines
- Include description of changes
- Reference related issues
- Ensure all tests pass
- Code review required for production changes

### Tooling Configuration

#### Vite Configuration
- React plugin enabled
- Tailwind CSS plugin enabled
- Path aliases configured (`@/` -> `./`)
- HMR configuration for development

#### TypeScript Configuration
- Strict mode enabled
- ES2022 target
- JSX transform: react-jsx
- Path mapping for clean imports

This document should be updated as the codebase evolves and new patterns emerge.