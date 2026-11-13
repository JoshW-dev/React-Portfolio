import { redirect } from "next/navigation";

// The film is the home page now. Old links to /film still work.
export default function FilmPage() {
  redirect("/");
}
