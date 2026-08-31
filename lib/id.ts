import * as Crypto from 'expo-crypto';

/** UUID primary keys keep rows collision-free across devices for future sync. */
export const newId = (): string => Crypto.randomUUID();
