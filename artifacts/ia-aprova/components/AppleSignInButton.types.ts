export type AppleSignInButtonProps = {
  disabled?: boolean;
  onLoadingChange: (loading: boolean) => void;
  onError: (message: string | null) => void;
};
