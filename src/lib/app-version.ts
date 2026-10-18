import packageJson from "../../package.json";

/** `package.json`の`version`。`/api/app-version`が稼働中の版として返す（#151）。 */
export const APP_VERSION: string = packageJson.version;
