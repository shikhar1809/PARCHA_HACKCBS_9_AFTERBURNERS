/**
 * The mobile shell both apps are built from.
 *
 * Portrait-first: every screen is laid out at phone width, with an app bar
 * that stays put, one scrolling body, and a tab bar at the bottom. On a
 * desktop browser the PhoneFrame centres that inside a 9:16 device frame so
 * the thing can be looked at during development; on a phone the frame drops
 * away and the app fills the viewport.
 */
export { cn } from "./cn";
export { PhoneFrame, Screen } from "./phone-frame";
export { Logo, Wordmark } from "./logo";
export { AppBar, TabBar, ActionBar, type TabItem } from "./chrome";
export { Splash, useFontsReady, useMinTime } from "./splash";
