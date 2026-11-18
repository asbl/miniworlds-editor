/** `lowMemory` of config.json: "auto" decides by the device, true/false forces. */
export type LowMemorySetting = 'auto' | boolean

/** Devices with 4 GB of RAM or less (Chromebooks, old tablets): the editor help (a second Python) only runs while someone edits. */
export const LOW_MEMORY_GB = 4

export function isLowMemory(setting: LowMemorySetting, nav: { deviceMemory?: number } = typeof navigator === 'undefined' ? {} : (navigator as { deviceMemory?: number })): boolean {
  if (setting !== 'auto') return setting
  // deviceMemory exists in Chromium only (a rounded value: 0.25 … 8); elsewhere the device is treated as roomy
  return typeof nav.deviceMemory === 'number' && nav.deviceMemory <= LOW_MEMORY_GB
}
