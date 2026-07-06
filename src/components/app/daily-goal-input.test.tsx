// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyGoalInput } from "@/components/app/daily-goal-input";

afterEach(cleanup);

describe("DailyGoalInput", () => {
  it("prefills 500 when no goal is set yet", () => {
    render(<DailyGoalInput value={null} submitLabel="Set" onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Daily word goal") as HTMLInputElement).value).toBe("500");
  });

  it("prefills the current goal when editing", () => {
    render(<DailyGoalInput value={750} submitLabel="Save" onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Daily word goal") as HTMLInputElement).value).toBe("750");
  });

  it("submits the parsed integer goal", () => {
    const onSubmit = vi.fn();
    render(<DailyGoalInput value={null} submitLabel="Set" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Daily word goal"), { target: { value: "800" } });
    fireEvent.click(screen.getByText("Set"));
    expect(onSubmit).toHaveBeenCalledWith(800);
  });

  it("submits on Enter", () => {
    const onSubmit = vi.fn();
    render(<DailyGoalInput value={null} submitLabel="Set" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText("Daily word goal"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(500);
  });

  it("does not submit an empty or zero goal", () => {
    const onSubmit = vi.fn();
    render(<DailyGoalInput value={null} submitLabel="Set" onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Daily word goal");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Set"));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("Set"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
