import { render, screen } from "@testing-library/react";

import App from "./App";

test("renders the SSMS header", () => {
  render(<App />);
  expect(screen.getByText(/ssms/i)).toBeInTheDocument();
});
