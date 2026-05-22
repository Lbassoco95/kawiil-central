import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { type OrgUser } from "@/hooks/useOrgUsers";
import { type MailDirectoryContact } from "@/hooks/useMailDirectory";

interface ComposeRecipientInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  id?: string;
  orgUsers: OrgUser[];
  mailContacts: MailDirectoryContact[];
  teamEmailLowerSet: Set<string>;
  /** Si se provee, se usa este elemento en lugar del Input de shadcn (para drawers con CSS propio). */
  inputClassName?: string;
}

export function ComposeRecipientInput({
  value,
  onChange,
  placeholder,
  id,
  orgUsers,
  mailContacts,
  teamEmailLowerSet,
  inputClassName,
}: ComposeRecipientInputProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const parts = value.split(",");
  const lastQuery = (parts[parts.length - 1] ?? "").trim().toLowerCase();

  const teamSuggestions = useMemo(
    () =>
      orgUsers
        .map((u) => ({
          user_id: u.user_id,
          email: u.email || "",
          full_name: u.full_name || u.email || "",
        }))
        .filter((u) => u.email),
    [orgUsers]
  );

  const filteredTeam = useMemo(() => {
    if (!lastQuery) return [];
    return teamSuggestions
      .filter(
        (u) =>
          u.email.toLowerCase().includes(lastQuery) ||
          u.full_name.toLowerCase().includes(lastQuery)
      )
      .slice(0, 8);
  }, [teamSuggestions, lastQuery]);

  const filteredMailbox = useMemo(() => {
    if (!lastQuery) return [];
    return mailContacts
      .filter((c) => {
        if (teamEmailLowerSet.has(c.email.toLowerCase())) return false;
        const name = (c.display_name || "").toLowerCase();
        return c.email.includes(lastQuery) || name.includes(lastQuery);
      })
      .slice(0, 8);
  }, [mailContacts, lastQuery, teamEmailLowerSet]);

  const showList =
    menuOpen && lastQuery.length >= 1 && (filteredTeam.length > 0 || filteredMailbox.length > 0);

  const pick = (email: string) => {
    const before = parts.slice(0, -1).join(",").trim();
    const next = before ? `${before}, ${email}` : email;
    onChange(next);
    setMenuOpen(false);
  };

  return (
    <div className="relative flex-1 min-w-0">
      {inputClassName ? (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClassName}
          onFocus={() => setMenuOpen(true)}
          onBlur={() => setTimeout(() => setMenuOpen(false), 200)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full"
          onFocus={() => setMenuOpen(true)}
          onBlur={() => setTimeout(() => setMenuOpen(false), 200)}
        />
      )}
      {showList && (
        <div className="cri-dropdown">
          {filteredTeam.length > 0 ? (
            <div className="cri-section">
              <div className="cri-section-label">Equipo</div>
              {filteredTeam.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  className="cri-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u.email)}
                >
                  <span className="cri-item-name">{u.full_name}</span>
                  <span className="cri-item-email">{u.email}</span>
                </button>
              ))}
            </div>
          ) : null}
          {filteredMailbox.length > 0 ? (
            <div className={`cri-section${filteredTeam.length > 0 ? " cri-section--bordered" : ""}`}>
              <div className="cri-section-label">Buzón</div>
              {filteredMailbox.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  className="cri-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.email)}
                >
                  <span className="cri-item-name">{c.display_name || c.email}</span>
                  <span className="cri-item-email">{c.email}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
