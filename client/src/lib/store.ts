/**
 * Global state management with Zustand
 * Manages: PDF viewer, AI config, pet interactions, UI panels
 */
import { create } from 'zustand';

import { getAIConfigSnapshot, persistAIConfig } from './browser-runtime-storage';
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type AppLocale,
} from './locale';
import {
  createBrowserAIConfig,
  createDefaultAIConfig,
  createServerAIConfig,
  loadPersistedAISettings,
  savePersistedAISettings,
  type AIConfig,
  type AIConfigMode,
} from './ai-config';
import { CAN_USE_ADVANCED_RUNTIME } from './deploy-target';

export type { AIConfig, AIConfigMode } from './ai-config';

export type RuntimeMode = 'frontend' | 'advanced';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  petName?: string;
  timestamp: number;
}

interface AppState {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;

  currentPage: number;
  totalPages: number;
  isPdfOpen: boolean;
  setCurrentPage: (page: number) => void;
  togglePdf: () => void;
  openPdf: () => void;
  closePdf: () => void;

  runtimeMode: RuntimeMode;
  setRuntimeMode: (mode: RuntimeMode) => Promise<void>;

  serverAIConfig: AIConfig;
  aiConfig: AIConfig;
  isAIConfigLoading: boolean;
  hydrateAIConfig: () => Promise<void>;
  updateBrowserAIConfig: (patch: Partial<AIConfig>) => void;
  setAIConfigMode: (mode: AIConfigMode) => void;
  resetBrowserAIConfig: () => void;
  isConfigOpen: boolean;
  setConfigOpen: (open: boolean) => void;
  toggleConfig: () => void;

  chatMessages: ChatMessage[];
  isChatOpen: boolean;
  isLoading: boolean;
  addMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
  toggleChat: () => void;
  setLoading: (loading: boolean) => void;

  selectedPet: string | null;
  setSelectedPet: (pet: string | null) => void;

  isSceneReady: boolean;
  setSceneReady: (ready: boolean) => void;
  loadingProgress: number;
  setLoadingProgress: (progress: number) => void;

  // Voice state (multi-modal-agent)
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  sttAvailable: boolean;
  setSttAvailable: (available: boolean) => void;
  ttsAvailable: boolean;
  setTtsAvailable: (available: boolean) => void;
}

const DEFAULT_AI_CONFIG = createDefaultAIConfig();
const RUNTIME_MODE_STORAGE_KEY = 'whybuddy-runtime-mode';

function getSafeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStorageValue(key: string): string | null {
  const storage = getSafeLocalStorage();
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage failures in SSR, fake window, and isolated test environments.
  }
}

function isBlueprintChineseRoute(pathname: string): boolean {
  const normalized = pathname.trim() || '/';
  return (
    normalized === '/autopilot' ||
    normalized.startsWith('/autopilot/') ||
    normalized === '/specs' ||
    normalized.startsWith('/specs/')
  );
}

function getInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  const stored = readStorageValue(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const pathname = window.location?.pathname ?? '/';
  if (isBlueprintChineseRoute(pathname)) return 'zh-CN';

  return DEFAULT_LOCALE;
}

function persistLocale(locale: AppLocale) {
  writeStorageValue(LOCALE_STORAGE_KEY, locale);
}

function createPreviewAIConfig(): AIConfig {
  return createServerAIConfig({
    baseUrl: 'browser-preview',
    model: 'Local demo responses',
    modelReasoningEffort: 'instant',
    maxContext: 32000,
    providerName: 'Built-in browser preview',
    timeoutMs: 2000,
    stream: false,
  });
}

function persistAIConfigSnapshot(config: AIConfig) {
  return persistAIConfig({ ...config });
}

function getInitialRuntimeMode(): RuntimeMode {
  if (!CAN_USE_ADVANCED_RUNTIME) return 'frontend';
  if (typeof window === 'undefined') return 'frontend';

  const stored = readStorageValue(RUNTIME_MODE_STORAGE_KEY);
  return stored === 'advanced' ? 'advanced' : 'frontend';
}

function persistRuntimeMode(mode: RuntimeMode) {
  writeStorageValue(RUNTIME_MODE_STORAGE_KEY, mode);
}

function getFrontendAIConfig(serverConfig: AIConfig): AIConfig {
  const persisted = loadPersistedAISettings(serverConfig);
  return persisted.mode === 'browser_direct'
    ? persisted.browserConfig
    : createPreviewAIConfig();
}

const initialRuntimeMode = getInitialRuntimeMode();

export const useAppStore = create<AppState>((set, get) => ({
  locale: getInitialLocale(),
  setLocale: locale => {
    persistLocale(locale);
    set({ locale });
  },
  toggleLocale: () => {
    const nextLocale: AppLocale = get().locale === 'zh-CN' ? 'en-US' : 'zh-CN';
    persistLocale(nextLocale);
    set({ locale: nextLocale });
  },

  currentPage: 1,
  totalPages: 33,
  isPdfOpen: false,
  setCurrentPage: page => set({ currentPage: Math.max(1, Math.min(page, 33)) }),
  togglePdf: () => set(state => ({ isPdfOpen: !state.isPdfOpen })),
  openPdf: () => set({ isPdfOpen: true }),
  closePdf: () => set({ isPdfOpen: false }),

  runtimeMode: initialRuntimeMode,
  setRuntimeMode: async mode => {
    if (mode === 'advanced' && !CAN_USE_ADVANCED_RUNTIME) {
      persistRuntimeMode('frontend');
      const state = get();
      const nextAIConfig = getFrontendAIConfig(state.serverAIConfig || DEFAULT_AI_CONFIG);
      void persistAIConfigSnapshot(nextAIConfig).catch(storageError => {
        console.warn('[Runtime Mode] Failed to persist browser snapshot:', storageError);
      });
      set({
        runtimeMode: 'frontend',
        aiConfig: nextAIConfig,
        isAIConfigLoading: false,
      });
      return;
    }

    persistRuntimeMode(mode);

    if (mode === 'frontend') {
      const state = get();
      const nextAIConfig = getFrontendAIConfig(state.serverAIConfig || DEFAULT_AI_CONFIG);
      void persistAIConfigSnapshot(nextAIConfig).catch(storageError => {
        console.warn('[Runtime Mode] Failed to persist browser snapshot:', storageError);
      });
      set({
        runtimeMode: mode,
        aiConfig: nextAIConfig,
        isAIConfigLoading: false,
      });
      return;
    }

    set({ runtimeMode: mode });
    try {
      await get().hydrateAIConfig();
    } catch (error) {
      console.error('[Runtime Mode] Failed to hydrate advanced config:', error);
    }
  },

  serverAIConfig: DEFAULT_AI_CONFIG,
  aiConfig:
    initialRuntimeMode === 'frontend'
      ? getFrontendAIConfig(DEFAULT_AI_CONFIG)
      : DEFAULT_AI_CONFIG,
  isAIConfigLoading: false,
  hydrateAIConfig: async () => {
    if (get().runtimeMode === 'frontend') {
      const nextAIConfig = getFrontendAIConfig(get().serverAIConfig || DEFAULT_AI_CONFIG);
      void persistAIConfigSnapshot(nextAIConfig).catch(storageError => {
        console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
      });
      set({
        aiConfig: nextAIConfig,
        isAIConfigLoading: false,
      });
      return;
    }

    set({ isAIConfigLoading: true });

    try {
      const response = await fetch('/api/config/ai');
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }

      const data = await response.json();
      const serverAIConfig = createServerAIConfig(data.config || {});
      const persisted = loadPersistedAISettings(serverAIConfig);
      const aiConfig =
        persisted.mode === 'browser_direct'
          ? persisted.browserConfig
          : serverAIConfig;

      void persistAIConfigSnapshot(aiConfig).catch(storageError => {
        console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
      });

      set({
        serverAIConfig,
        aiConfig,
        isAIConfigLoading: false,
      });
    } catch (error) {
      console.error('[AI Config] Failed to hydrate config:', error);
      try {
        const cachedConfig = await getAIConfigSnapshot();
        if (cachedConfig) {
          const fallbackServerAIConfig = get().serverAIConfig || DEFAULT_AI_CONFIG;
          const cachedMode =
            cachedConfig.mode === 'browser_direct' ? 'browser_direct' : 'server_proxy';
          const cachedServerAIConfig = createServerAIConfig(
            cachedMode === 'server_proxy' ? cachedConfig : fallbackServerAIConfig
          );
          const aiConfig =
            cachedMode === 'browser_direct'
              ? createBrowserAIConfig(cachedConfig, cachedServerAIConfig)
              : cachedServerAIConfig;

          set({
            serverAIConfig: cachedServerAIConfig,
            aiConfig,
            isAIConfigLoading: false,
          });
          return;
        }
      } catch (storageError) {
        console.warn('[AI Config] Failed to load browser snapshot:', storageError);
      }

      const fallbackServerAIConfig = get().serverAIConfig || DEFAULT_AI_CONFIG;
      const persisted = loadPersistedAISettings(fallbackServerAIConfig);
      const aiConfig =
        persisted.mode === 'browser_direct'
          ? persisted.browserConfig
          : fallbackServerAIConfig;

      set({
        serverAIConfig: fallbackServerAIConfig,
        aiConfig,
        isAIConfigLoading: false,
      });
      throw error;
    }
  },
  updateBrowserAIConfig: patch => {
    const state = get();
    const nextConfig = createBrowserAIConfig(
      {
        ...state.aiConfig,
        ...patch,
      },
      state.serverAIConfig
    );

    savePersistedAISettings('browser_direct', nextConfig);
    void persistAIConfigSnapshot(nextConfig).catch(storageError => {
      console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
    });
    set({ aiConfig: nextConfig });
  },
  setAIConfigMode: mode => {
    const state = get();

    if (mode === 'browser_direct') {
      const nextConfig = createBrowserAIConfig(state.aiConfig, state.serverAIConfig);
      savePersistedAISettings('browser_direct', nextConfig);
      void persistAIConfigSnapshot(nextConfig).catch(storageError => {
        console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
      });
      set({ aiConfig: nextConfig });
      return;
    }

    savePersistedAISettings('server_proxy', state.aiConfig);
    const nextConfig =
      state.runtimeMode === 'frontend' ? createPreviewAIConfig() : state.serverAIConfig;
    void persistAIConfigSnapshot(nextConfig).catch(storageError => {
      console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
    });
    set({ aiConfig: nextConfig });
  },
  resetBrowserAIConfig: () => {
    const state = get();
    const nextConfig = createBrowserAIConfig({}, state.serverAIConfig);
    savePersistedAISettings('browser_direct', nextConfig);
    void persistAIConfigSnapshot(nextConfig).catch(storageError => {
      console.warn('[AI Config] Failed to persist browser snapshot:', storageError);
    });
    set({ aiConfig: nextConfig });
  },
  isConfigOpen: false,
  setConfigOpen: open => set({ isConfigOpen: open }),
  toggleConfig: () => set(state => ({ isConfigOpen: !state.isConfigOpen })),

  chatMessages: [],
  isChatOpen: false,
  isLoading: false,
  addMessage: msg => set(state => ({ chatMessages: [...state.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [] }),
  toggleChat: () => set(state => ({ isChatOpen: !state.isChatOpen })),
  setLoading: loading => set({ isLoading: loading }),

  selectedPet: null,
  setSelectedPet: pet => set({ selectedPet: pet }),

  isSceneReady: false,
  setSceneReady: ready => set({ isSceneReady: ready }),
  loadingProgress: 0,
  setLoadingProgress: progress => set({ loadingProgress: progress }),

  // Voice state (multi-modal-agent)
  ttsEnabled: false,
  setTtsEnabled: enabled => set({ ttsEnabled: enabled }),
  sttAvailable: false,
  setSttAvailable: available => set({ sttAvailable: available }),
  ttsAvailable: false,
  setTtsAvailable: available => set({ ttsAvailable: available }),
}));
