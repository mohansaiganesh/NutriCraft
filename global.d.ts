// NativeWind global stylesheet (side-effect import in the root layout).
declare module '*.css';

// Drizzle's Expo migrator bundle (generated JS in the excluded ./drizzle folder).
declare module '*/drizzle/migrations' {
  const migrations: {
    journal: unknown;
    migrations: Record<string, string>;
  };
  export default migrations;
}
