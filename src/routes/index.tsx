import { createFileRoute } from "@tanstack/react-router";
import { GuideApp } from "@/components/guide/GuideApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <GuideApp />;
}
