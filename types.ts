export interface Vector {
    x: number;
    y: number;
}

export interface GameConfig {
    credits: number;
    power: number;
    wave: number;
}

export enum EntityType {
    // Buildings
    CONSTRUCTION_YARD = 'CONSTRUCTION_YARD',
    POWER_PLANT = 'POWER_PLANT',
    REFINERY = 'REFINERY',
    BARRACKS = 'BARRACKS',
    FACTORY = 'FACTORY',
    CANNON = 'CANNON',
    
    // Units
    INFANTRY = 'INFANTRY',
    TANK = 'TANK',
    HARVESTER = 'HARVESTER',
    
    // Resource
    ORE = 'ORE'
}

export interface TypeDefinition {
    name: string;
    w: number; // Width in tiles
    h: number; // Height in tiles
    hp: number;
    cost: number;
    power: number; // Positive generates, negative consumes
    speed?: number;
    range?: number;
    damage?: number;
    fireRate?: number;
    buildTime?: number;
    radius?: number;
    capacity?: number; // For harvester
}

export interface Entity {
    id: string;
    pos: Vector;
    type: EntityType;
    team: 'player' | 'enemy';
    hp: number;
    maxHp: number;
    dead: boolean;
    radius: number;
    
    // Specific props
    selected?: boolean;
    targetPos?: Vector | null;
    targetUnit?: Entity | null;
    cooldown?: number;
    cargo?: number;
    harvestState?: 'idle' | 'moving_to_ore' | 'harvesting' | 'returning';
    turretAngle?: number;
}

export interface OrePatch {
    pos: Vector;
    amount: number;
}

export interface Particle {
    pos: Vector;
    vel: Vector;
    life: number;
    color: string;
}
