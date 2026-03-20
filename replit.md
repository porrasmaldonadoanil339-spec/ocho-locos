# Ocho Locos

## Overview

Ocho Locos is a mobile card game application, a Spanish-language adaptation of "Crazy Eights," developed using Expo (React Native) for the frontend and Express.js for the backend. The game offers extensive features including 7 game modes, local and online multiplayer (2–6 players), a customizable store with 500+ items, 981 achievements, an 800-tier battle pass, daily rewards, and an emote system. The app supports 22-language i18n, avatar customization, swipe tab navigation, and light/dark mode. A key design principle is that all core game logic executes on-device, with the backend primarily serving as an API scaffold and static asset server.

## User Preferences

Preferred communication style: Simple, everyday language.
No emojis in UI or code. Use @expo/vector-icons (Ionicons) for all icons.
"OCHO LOCOS" brand name NEVER translates.

## System Architecture

### Frontend (Expo / React Native)
- **Routing**: Expo Router (file-based) with root layout (`app/_layout.tsx`) and tab navigation (`app/(tabs)/`).
- **State Management**: React Context for profile and game states, with AsyncStorage for persistence. **Cloud Save** (`context/ProfileContext.tsx`): When authenticated (non-guest), profile is synced to server via POST `/api/auth/profile` on every save (fire-and-forget). On app startup, if authenticated, fetches cloud profile from GET `/api/auth/profile` and merges (server wins for coins/XP/stats).
- **Styling**: Exclusively uses React Native's `StyleSheet`.
- **Fonts**: Nunito (400Regular, 700Bold, 800ExtraBold) from `@expo-google-fonts/nunito`. Always reference `Nunito_800ExtraBold` — not 900 (doesn't exist).
- **Internationalization (i18n)**: `lib/i18n.ts` for 22+ language translations, `hooks/useT.ts` for language selection from ProfileContext. `lib/achTranslations.ts` handles localized achievement, emote, mode, and difficulty descriptions. Language fallback chain: `entry[lang] ?? entry["en"] ?? entry["es"]` — all 19 non-Spanish/Portuguese languages fall back to English first. Language selector in `app/settings.tsx`. **Game Engine i18n**: `lib/gameEngine.ts` exports `setEngineLang(lang)`, `gm(key, vars)`, and `suitName(suit)` which are all language-aware. All in-game messages (CPU plays, suit names, draw messages, win messages) are fully translated into 22 languages via the GM table in gameEngine.ts. `game.tsx` calls `setEngineLang(profile.language)` via useEffect. `lib/multiplayerEngine.ts` imports and uses `gm()` for all its messages too. `app/rules.tsx` fully translated into 22 languages via i18n keys (ruleGoalT/D, ruleDealT/D, rulePlayT/D, ruleEightsT/D, ruleDrawT/D, ruleDeckT/D, ruleWinT/D). All hardcoded Spanish strings replaced with T() across game-online.tsx, online-lobby.tsx, ranked-lobby.tsx, ranked.tsx, friends.tsx, profile.tsx, index.tsx.
- **Theming**: `hooks/useTheme.ts` dynamically applies `DarkColors` or `LightColors` from `constants/colors.ts` based on `profile.darkMode` setting. The UI adopts a dark casino theme (felt-green with gold accents) with a corresponding light mode.
- **Core Game Logic**: `lib/gameEngine.ts` implements all card game mechanics, including special card effects (2, 3, 7, 8, 10, J, Joker) and AI strategies tailored across five difficulty levels (Easy to Expert). All AI opponents are referred to as "Rival" (not "CPU") in all UI text.
- **Rival Generator**: `lib/rivalGenerator.ts` — procedural generator for 100,000+ unique rival profiles. Deterministic by index (always same profile for same index), uses seeded hash. Profiles include realistic Latin American names, pravatar.cc photo URLs (img 1-99), varied level distribution. `pickRivals(n, playerLevel)` picks N rivals near player level with no repeats in same match (time-based seed offset). `lib/cpuProfiles.ts` `pickCpuProfiles()` now uses the generator as primary source. Ranking screen leaderboard independently generates 1000+ entries.
- **Multiplayer**: Supports local pass-device multiplayer (`game-multi.tsx`) and both real WebSocket online multiplayer and CPU-simulated online (`game-online.tsx`). Real online mode uses Socket.IO via `lib/onlineSocket.ts` connected to the backend.
- **Online Lobby System** (`app/online-lobby.tsx`): Full real-time matchmaking flow with Quick Match (auto-matchmaking queue), Create Room (room code sharing), and Join by Code options. Shows pre-match team composition screen (Team 1 vs Team 2 with avatars) before the game starts. WebSocket-based real-time player slot filling animation.
- **Animation**: Utilizes Reanimated for shuffle and deal animations, and Animated Views for particle effects and UI banners.
- **Store System**: Features 8 categories: card_back (90), avatar, frame, title, effect, emote, table_design (90), card_design (90). Total: 500+ store items. Card designs change face appearance in game. Table designs change game table background. `getCardDesignById()` and `getTableDesignById()` in `lib/storeItems.ts`. `ProfileContext` holds `cardDesignId` and `tableDesignId`. Store tabs: Dorso, Cartas, Mesas, Avatar, Marco, Título, Efecto, Emotes.
- **Battle Pass & Achievements**: An 800-tier battle pass and 981 achievements. Achievements screen has 2 tabs ONLY: Logros + Pase de Batalla (Clasificatoria REMOVED from achievements).
- **Audio System**: Single-source-of-truth audio managed by `AudioManager` component in `_layout.tsx`. Uses `GAME_MUSIC_ROUTES = ["game", "game-online", "game-multi"]` to switch between menu/game music on navigation. Serialization lock in `lib/audioManager.ts` prevents concurrent transitions. Rule: ONLY `_layout.tsx` triggers music transitions via `startMenuMusic()`/`startGameMusic()`; game screens may only call `stopMusic()` on game-over events.
- **Splash Screen**: Epic Clash of Clans style splash (5 seconds). Logo 240x240, pulsating golden glow, "BIYIS PRIME STUDIOS" in gold, "PRESENTA" subtitle, "OCHO LOCOS" title, gold separator, floating gold particles, "Versión 1.0" footer. Dark gradient bg. Implemented in `app/_layout.tsx`.
- **Seasons System**: `lib/seasons.ts` — 30-day competitive seasons. Season 1 "Hierro y Fuego" starts 2026-03-01. Tiered rewards (500–12,000 coins) by rank at season end.
- **Ranked/Clasificatoria**: `app/ranked.tsx` with 10,000 deterministic players (seeded generation, FlatList pagination - 50 per load). Season banner, countdown, rewards modal. LOCKED until player level 5. Profile card shown at top. Gold/silver/bronze colors for top 3.
- **Game Modes**: **Routing rule**: Practice → difficulty picker → local game; Classic/Lightning/Tournament/Challenge → `startGame()` then directly to `/game`; **Ranked** → `ranked-lobby.tsx` (pre-lobby UI) → `/game-online?count=4&mode=ranked&skipLobby=true` (4-player game, skips game-online's own lobby animation); **Coop** → `coop-lobby.tsx` (2v2 team lobby UI) → `/game-online?count=4&mode=coop&skipLobby=true&names=cpu1,cpu2,cpu3` (4-player coop game with matching CPU names); **Online** → `online-lobby.tsx` → real socket matchmaking or direct fake search → `/game-online` (full 4-player). `game-online.tsx` supports `skipLobby=true` (skip 6-10s search anim, start dealing immediately) and `names=` (comma-separated CPU override names). `hasDifficulty: true` ONLY for Practice mode.
- **Turn Timer**: Inactivity bar in game.tsx appears after 4s idle (0s in Lightning mode). Countdown shown next to bar. Lightning timeout = 5s; Practice = 30s; Default = 20s. LightningBanner component shows "MODO RELÁMPAGO" for 3s on deal.
- **Tournament System**: TournamentModal tracks round results with star scoring (⭐ per win), "ROUND FINAL" message on 1-1 tie, round-result messages with animated entrance.
- **Ranked Stars**: RankedResultOverlay shown after ranked matches for promotion/demotion with star animation and descriptive messages.
- **First-Launch Auth Flow**: `app/_layout.tsx` wraps `CustomSplashScreen` in `SplashWithAuth` which checks `useAuth().user`. On first launch (no saved session), shows Google/Facebook/Guest login buttons at bottom of splash screen after loading bar completes. `SplashOAuthModal` handles email/password entry for OAuth. Buttons use all 22-language i18n via `useT()`. All strings are in `lib/i18n.ts` under `splashConnect*`, `splashContinue*`, `splashPlayGuest`, etc. keys.
- **Login Flow (settings/login page)**: Google/Facebook buttons open email modal (setOauthProvider); email validated with full regex; handleOAuthSubmit tries login() then register() as fallback; linkAccount() called on success. Google button styled with multicolor "G" dots (4 brand colors) on white circle. Facebook button is solid #1877F2 blue. **Forgot Password**: "¿Olvidaste tu contraseña?" link in login form opens recovery modal. User enters username; POST /api/auth/forgot-password returns success. Modal shows green checkmark on success.
- **i18n**: 22 languages fully supported. All texts connected to translation system. i18n overhaul completed: 80+ new translation keys added. Latest additions (2026-03): `splashConnectTitle`, `splashConnectSub`, `splashContinueGoogle`, `splashContinueFacebook`, `splashPlayGuest`, `splashGuestNoteText`, `splashEmailField`, `splashPasswordField`, `splashBack`, `splashNext`, `splashSignIn`, `splashWelcome`, `splashLinked`, `splashEmailValid`, `splashPasswordLength`, `splashLoginError`, `splashContinueWith`. Earlier additions include: `diffEasyDesc`–`diffExpertDesc`, `rankedLockedDesc`, `rankedUnlockedDesc`, `dailyChallenges`, room code keys, status keys, matchmaking/lobby keys, toast message keys, settings alert texts, `specialRules`, `specialRulesSub`, `acceptChallenge`, `rankPromoted`, `rankPromotedSub`, `rankDemoted`, `rankDemotedSub`, `ruleViolatedRed`, `ruleViolatedBlack`, etc.). Hardcoded strings eliminated from: `index.tsx`, `ranked-lobby.tsx`, `online-lobby.tsx`, `game.tsx` (`ChallengeRulesModal` titles, `RankedResultOverlay` promotion/demotion texts, challenge rule violation messages), `friends.tsx`, `settings.tsx`, `login.tsx`. All 22 languages covered for every key. `game.tsx` imports both `useT` hook and `t()` function (for event-handler use).
- **Country Picker**: Fixed modal in `app/(tabs)/profile.tsx` with maxHeight:420, proper flex layout, and ScrollView for all 60+ countries across continents.

### Backend (Express.js)
- Runs on port 5000.
- Serves as a minimal API scaffold and static asset server, including `server/templates/landing-page.html`.
- No database is currently required as all game data is stored on-device.
- **Authentication System**: Features JWT-like token authentication with PBKDF2 password hashing. Supports user registration, login, and integrations for Google and Facebook OAuth. User data stored in `/tmp/ocho_users.json`. **New endpoints**: POST `/api/auth/forgot-password` (username-based recovery, tokens in `/tmp/ocho_reset_tokens.json`); POST `/api/auth/reset-password`; GET/POST `/api/auth/profile` (cloud save — profile data per authenticated user stored in `/tmp/ocho_profiles.json`).
- **Real-time Multiplayer** (`server/rooms.ts`): Socket.IO server managing game rooms and matchmaking. Events: `create_room`, `join_room`, `join_matchmaking`, `cancel_matchmaking`, `play_card`, `draw_card`, `choose_suit`, `leave_room`. Auto-matchmaking queue groups players by mode+playerCount. `pre_match` event broadcasts all player profiles before game starts. `game_state` events broadcast authoritative game state to each player with their own hand. AI autoplay fills in for missing human players.

## External Dependencies

- **Expo / React Native**: Frontend framework.
- **Express.js**: Backend server.
- **@expo/vector-icons (Ionicons)**: For all in-app icons.
- **@expo-google-fonts/nunito**: Provides Nunito font variations.
- **AsyncStorage**: For on-device data persistence.
- **React Context**: For state management.
- **React Query**: For client-side data fetching and caching.
- **Reanimated**: For complex UI animations.
- **expo-audio**: For managing in-game sounds and music.
- **expo-auth-session**: For authentication flows.
- **expo-crypto**: For cryptographic functions in authentication.
- **NetInfo**: For network status detection.