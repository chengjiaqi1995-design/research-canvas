import { create } from 'zustand';
import type { Transcription } from '../types';

interface TranscriptionState {
  transcriptions: Transcription[];
  currentTranscription: Transcription | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setTranscriptions: (transcriptions: Transcription[]) => void;
  setCurrentTranscription: (transcription: Transcription | null) => void;
  addTranscription: (transcription: Transcription) => void;
  updateTranscription: (id: string, updates: Partial<Transcription>) => void;
  removeTranscription: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  transcriptions: [],
  currentTranscription: null,
  isLoading: false,
  error: null,

  setTranscriptions: (transcriptions) => set({ transcriptions }),

  setCurrentTranscription: (transcription) => set({ currentTranscription: transcription }),

  addTranscription: (transcription) =>
    set((state) => ({
      transcriptions: [transcription, ...state.transcriptions],
    })),

  updateTranscription: (id, updates) =>
    set((state) => ({
      transcriptions: state.transcriptions.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
      currentTranscription:
        state.currentTranscription?.id === id
          ? { ...state.currentTranscription, ...updates }
          : state.currentTranscription,
    })),

  removeTranscription: (id) =>
    set((state) => ({
      transcriptions: state.transcriptions.filter((t) => t.id !== id),
      currentTranscription:
        state.currentTranscription?.id === id ? null : state.currentTranscription,
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),
}));
