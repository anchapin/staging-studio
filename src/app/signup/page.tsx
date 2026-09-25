import { redirect } from "next/navigation";

// /signup doesn't have its own registration flow.
// Redirect to /login where new users can sign in via Magic Link,
// which creates their account on first use.
export default function SignupPage() {
  redirect("/login");
}
