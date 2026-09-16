import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import PasswordInput from "@/components/ui/PasswordInput";

describe("PasswordInput", () => {
  it("reveals and hides the value without changing it", async () => {
    const user = userEvent.setup();
    render(
      <label>
        Password
        <PasswordInput aria-label="Password" defaultValue="SecurePass9" />
      </label>,
    );

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    await user.click(show);

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("SecurePass9");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });
});
