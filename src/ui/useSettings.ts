import { useSyncExternalStore } from 'react';
import { settings, type Settings } from '../game/settings';

/** The player's settings, re-rendering when they change */
export const useSettings = (): Settings => useSyncExternalStore(settings.subscribe, settings.get);
