/**
 * null.stub.ts
 * iOS build stub — replaces any component that must not appear on iOS.
 * The alias in vite.mobile.config.ts routes imports here at compile time,
 * so the original modules are never bundled. No download or plugin code,
 * no log messages, nothing.
 */
export default function NullComponent() {
  return null;
}
