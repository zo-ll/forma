/** The build runner creates this JSON file before Metro runs. A fresh checkout has no file. */
declare module '*mobile-build.json' {
  const metadata: {
    readonly sourceHead: string;
    readonly sourceDigest: string;
    readonly dirty: boolean;
    readonly fixtureCount: number;
    readonly reactNative: string;
    readonly opSqlite: string;
  };
  export default metadata;
}
