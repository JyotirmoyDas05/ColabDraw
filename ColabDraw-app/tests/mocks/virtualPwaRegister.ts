export const registerSW = (_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: any) => void;
  onRegisterError?: (error: any) => void;
}) => {
  return async (_reloadPage?: boolean) => {};
};
