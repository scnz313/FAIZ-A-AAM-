import type { Metadata } from "next";
import { Wallboard } from "@/components/facility/display/Wallboard";

export const metadata: Metadata = {
  title: "Wallboard · Facility",
};

export default function DisplayPage() {
  return (
    <div>
      <h1 className="sr-only">Campus environment wallboard</h1>
      <Wallboard />
    </div>
  );
}
