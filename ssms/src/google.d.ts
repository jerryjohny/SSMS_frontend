interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      shape?: "rectangular" | "pill" | "circle" | "square";
      width?: string | number;
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
    }
  ) => void;
} 

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
