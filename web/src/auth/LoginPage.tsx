/** Fake login: pick one of six people. Role and department come with the profile. */
import { useNavigate, useSearchParams } from "react-router-dom";
import { USERS, homeFor, login, type User } from "../lib/users";

export default function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pick = (u: User) => {
    login(u.id);
    const next = params.get("next");
    nav(next && next !== "/login" && !(next.startsWith("/day") && u.role !== "expert") && !(next.startsWith("/learn") && u.role !== "practicer") ? next : homeFor(u));
  };
  const group = (role: User["role"]) => USERS.filter((u) => u.role === role);
  return (
    <div className="page narrow login">
      <h1>Who's working today?</h1>
      <p className="muted">Demo login: no passwords. Experts let Ada learn from their workday; practicers train on what the experts taught her.</p>
      {(["expert", "practicer"] as const).map((role) => (
        <section key={role}>
          <h3>{role === "expert" ? "Experts" : "New hires"}</h3>
          <div className="people">
            {group(role).map((u) => (
              <button key={u.id} className="person" onClick={() => pick(u)}>
                <span className="avatar" style={{ background: u.color }}>{u.short[0]}</span>
                <span className="who"><b>{u.name}</b><span className="muted small">{u.title}</span><span className="muted small">{u.departmentLabel} · {u.yearsInRole ? `${u.yearsInRole} years` : "started this month"}</span></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
