import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { industryCategoryApi } from '../db/apiClient.ts';
import { DEFAULT_INDUSTRY_CATEGORIES, type IndustryCategory } from '../constants/industryCategories.ts';

interface IndustryCategoryState {
  categories: IndustryCategory[];
  loaded: boolean;
  loading: boolean;

  loadCategories: (force?: boolean) => Promise<void>;
  saveCategories: (categories: IndustryCategory[]) => Promise<void>;
  addCategory: (label: string, icon: string, subCategories?: string[]) => Promise<void>;
  updateCategory: (index: number, patch: Partial<IndustryCategory>) => Promise<void>;
  deleteCategory: (index: number) => Promise<void>;
  addSubCategory: (categoryLabel: string, subCategory: string) => Promise<void>;
  removeSubCategory: (categoryLabel: string, subCategory: string) => Promise<void>;
}

export const useIndustryCategoryStore = create<IndustryCategoryState>()(
  immer((set, get) => ({
    categories: DEFAULT_INDUSTRY_CATEGORIES,
    loaded: false,
    loading: false,

    loadCategories: async (force = false) => {
      if (!force && (get().loaded || get().loading)) return;
      set({ loading: true });
      try {
        const data = await industryCategoryApi.get();
        if (data && Array.isArray(data.categories) && data.categories.length > 0) {
          set({ categories: data.categories, loaded: true, loading: false });
        } else {
          // First time: seed from defaults and save to backend
          const defaults = [...DEFAULT_INDUSTRY_CATEGORIES];
          set({ categories: defaults, loaded: true, loading: false });
          await industryCategoryApi.save({ categories: defaults });
        }
      } catch (err) {
        console.error('Failed to load industry categories:', err);
        set({ loaded: true, loading: false }); // use defaults
      }
    },

    saveCategories: async (categories) => {
      set({ categories });
      try {
        await industryCategoryApi.save({ categories });
      } catch (err) {
        console.error('Failed to save industry categories:', err);
      }
    },

    addCategory: async (label, icon, subCategories = []) => {
      const cats = [...get().categories, { label, icon, subCategories }];
      await get().saveCategories(cats);
    },

    updateCategory: async (index, patch) => {
      const cats = [...get().categories];
      if (index >= 0 && index < cats.length) {
        cats[index] = { ...cats[index], ...patch };
        await get().saveCategories(cats);
      }
    },

    deleteCategory: async (index) => {
      const cats = [...get().categories];
      if (index >= 0 && index < cats.length) {
        cats.splice(index, 1);
        await get().saveCategories(cats);
      }
    },

    addSubCategory: async (categoryLabel, subCategory) => {
      const cats = [...get().categories];
      const cat = cats.find(c => c.label === categoryLabel);
      if (cat && !cat.subCategories.includes(subCategory)) {
        cat.subCategories = [...cat.subCategories, subCategory];
        await get().saveCategories(cats);
      }
    },

    removeSubCategory: async (categoryLabel, subCategory) => {
      const cats = [...get().categories];
      const cat = cats.find(c => c.label === categoryLabel);
      if (cat) {
        cat.subCategories = cat.subCategories.filter(s => s !== subCategory);
        await get().saveCategories(cats);
      }
    },
  }))
);
