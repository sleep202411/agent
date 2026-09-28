// Keep native SDK loading lazy so web and binaries without these modules can
// still render the paywall and report the existing availability errors.
export function loadPurchases(): typeof import("react-native-purchases") {
  return require("react-native-purchases") as typeof import("react-native-purchases");
}

export function loadIap(): typeof import("react-native-iap") {
  return require("react-native-iap") as typeof import("react-native-iap");
}
