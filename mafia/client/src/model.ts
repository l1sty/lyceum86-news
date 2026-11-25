export const roles = {
  mafia: [
    "Мафія",
    "Разом із Доном обираєте, хто вибуде цієї ночі. Домовляйтеся вдень так, щоб місто вам повірило.",
  ],
  don: [
    "Дон",
    "Очолюєте мафію. Щоночі голосуєте за жертву й окремо перевіряєте, чи є обраний гравець детективом.",
  ],
  civilian: [
    "Мирний житель",
    "Слухайте інших, ставте запитання й голосуйте вдень. Ваше завдання — знайти всю мафію.",
  ],
  detective: [
    "Детектив",
    "Щоночі перевіряєте одного гравця. Результат бачите лише ви. Дон під час перевірки теж належить до мафії.",
  ],
  doctor: [
    "Лікар",
    "Щоночі захищаєте одного гравця. Можна захистити себе, але не ту саму людину дві ночі поспіль.",
  ],
} as const;
export type Role = keyof typeof roles;
export type Phase =
  | "lobby"
  | "reveal"
  | "night"
  | "day"
  | "vote"
  | "report"
  | "finished";
export type Choice = "attack" | "inspect" | "heal" | "vote";
export type Winner = "mafia" | "city" | "draw";
export const outcomes = {
  mafia: "Мафія перемогла",
  city: "Місто перемогло",
  draw: "Нічия",
};
export type Player = {
  id: string;
  name: string;
  photo: string;
  role: Role | null;
  alive: boolean;
  ready: boolean;
};
export type Room = {
  code: string;
  me: string;
  now: number;
  version: number;
  step: number;
  round: number;
  deadline: number;
  host: string;
  capacity: number;
  pace: "quick" | "standard";
  phase: Phase;
  spectator: boolean;
  role: Role | null;
  allies: string[];
  team_picks: Record<string, string>;
  players: Player[];
  choices: Partial<Record<Choice, string[]>>;
  selected: Partial<Record<Choice, string | null>>;
  vote_count: number;
  notes: { round: number; target: string; positive: boolean }[];
  chat: { uid: string; text: string; at: number; round: number }[];
  report: {
    source: "night" | "vote";
    victim: string | null;
    round: number;
  } | null;
  winner: Winner | null;
};
export type Home = {
  me: string;
  name: string;
  current: string | null;
  ticket: string | null;
};
export type Records = {
  leaders: { name: string; wins: number; games: number }[];
  stats: { wins: number; games: number; draws: number };
  history: {
    code: string;
    role: Role;
    ended: number;
    won: number;
    winner: Winner;
    rounds: number;
  }[];
};
export type Command = (
  action: string,
  data?: Record<string, unknown>,
) => Promise<boolean>;
export const art = (name: Role | "city") => "/mafia/art/" + name + ".webp";
