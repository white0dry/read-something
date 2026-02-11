import { ApiProvider, ApiConfig, ApiPreset, AppSettings } from '../../types';

export type SettingsView = 'MAIN' | 'PERSONA' | 'CHARACTER' | 'WORLDBOOK' | 'API' | 'STORAGE' | 'APPEARANCE';

export interface Persona {
  id: string;
  name: string;
  userNickname: string;
  description: string;
  avatar: string;
  boundRoles: string[];
}

export interface Character {
  id: string;
  name: string;
  nickname: string;
  description: string;
  avatar: string;
  boundWorldBookCategories: string[];
}

export interface WorldBookEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  insertPosition: 'BEFORE' | 'AFTER';
}

export interface ThemeClasses {
  containerClass: string;
  headingClass: string;
  cardClass: string;
  pressedClass: string;
  sectionIconClass: string;
  inputClass: string;
  btnClass: string;
  activeBorderClass: string;
  baseBorderClass: string;
  animationClass: string;
  isDarkMode: boolean;
}

export type { ApiProvider, ApiConfig, ApiPreset, AppSettings };
