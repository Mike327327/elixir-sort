/** Jedna jednotka tekutiny. `c` = index barvy, `id` = stabilní identita (kvůli odkrývání skrytých). */
export interface Unit {
  c: number;
  id: number;
}

/** Lahev = zásobník jednotek odspodu nahoru. */
export type Bottle = Unit[];

export type Tier = 'normal' | 'hard' | 'veryhard';

export interface Move {
  from: number;
  to: number;
  count: number;
}

export interface LevelMeta {
  /** Podíl náhodných „hladových“ hráčů, kteří skončí v bezvýchodné situaci (0–1). */
  failRate: number;
  /** Délka řešení nalezeného solverem (není nutně optimální). */
  solutionLength: number;
  /** Kolik kandidátů generátor zkusil. */
  candidates: number;
  /** Doba generování v ms. */
  ms: number;
}

export interface LevelParams {
  colors: number;
  bottles: number;
  empties: number;
  capMin: number;
  capMax: number;
  hidden: number;
  partial: number;
  failMin: number;
  failMax: number;
}

export interface LevelDef {
  level: number;
  version: number;
  tier: Tier;
  capacities: number[];
  bottles: Bottle[];
  /** Id jednotek, které jsou na začátku skryté. */
  hidden: number[];
  colors: number;
  params: LevelParams;
  meta: LevelMeta;
}
