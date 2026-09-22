export const RECOMMENDED_HOST_DANGEROUS_PATTERNS = [
  '\\brm\\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\\s+(?:/|/\\*|\\.\\.|\\./\\.\\.)(?:\\s|$)',
  '\\brm\\s+-[a-zA-Z]*\\s+(?:/|/\\*)(?:\\s|$)',
  '\\bmkfs(?:\\.\\w+)?\\b',
  '\\bfdisk\\b',
  '\\bdd\\s+if=.*of=/dev/[a-z0-9]+',
  '\\b(?:reboot|shutdown|poweroff|init\\s+0|init\\s+6)\\b',
  '>\\s*/dev/(?:sd[a-z]|nvme[0-9]|hd[a-z])',
  '\\bchmod\\s+-[a-zA-Z]*R[a-zA-Z]*\\s+[0-7]*777\\s+(?:/|/\\*)(?:\\s|$)',
  '\\bchown\\s+-[a-zA-Z]*R[a-zA-Z]*\\s+\\S+\\s+(?:/|/\\*)(?:\\s|$)',
  '(?:^|[|;&\\s])(?:sudo\\s+)?(?:passwd|chpasswd)(?:\\s|$)',
  ':\\(\\)\\s*\\{[^}]*:\\s*\\|[^}]*&\\s*\\}',
]
