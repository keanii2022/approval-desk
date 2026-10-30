// The two typefaces of the robot-eye look, self-hosted by next/font so no request
// goes to Google at run time. Both are exposed as CSS variables that village.css
// reads; the variables live on the page root (`.village-ui`), never on <html>, so the
// plain home page keeps its own system font.
import { IBM_Plex_Mono, Pixelify_Sans } from "next/font/google";

// Display face: a variable font, so one file covers 400, 600 and 700.
export const pixelFont = Pixelify_Sans({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-pixel",
  display: "swap",
});

// Mono face for the small technical labels.
export const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

/** Put this on the page root together with the class "village-ui". */
export const villageFontClass = `${pixelFont.variable} ${monoFont.variable}`;
