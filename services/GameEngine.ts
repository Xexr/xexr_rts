import { Entity, EntityType, Vector, OrePatch, Particle } from "../types";
import { DEFINITIONS, TILE_SIZE, COLORS } from "../constants";

export class GameEngine {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    
    width: number = 0;
    height: number = 0;
    
    // Game State
    credits: number = 2500; 
    power: number = 0;
    wave: number = 1;
    tick: number = 0;
    
    // Camera State
    camera: Vector = { x: 0, y: 0 };
    isPanning: boolean = false;
    dragStartCamera: Vector = { x: 0, y: 0 };
    dragStartMouse: Vector = { x: 0, y: 0 };
    
    // Entities
    buildings: Entity[] = [];
    units: Entity[] = [];
    projectiles: any[] = []; 
    particles: Particle[] = [];
    orePatches: OrePatch[] = [];
    
    // Interaction
    mouse: Vector = { x: 0, y: 0 }; // Screen space
    worldMouse: Vector = { x: 0, y: 0 }; // World space
    
    isDraggingSelection: boolean = false;
    selectionStart: Vector = { x: 0, y: 0 };
    buildMode: EntityType | null = null;
    
    // Production
    productionQueues: Record<string, { type: EntityType, progress: number, total: number } | null> = {
        barracks: null,
        factory: null
    };

    // Callback to update React UI
    onUpdateUI: (() => void) | null = null;
    onMessage: ((msg: string) => void) | null = null;
    onGameOver: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.resize();
        
        this.initLevel();
        
        // Bind events
        window.addEventListener('resize', () => this.resize());
        
        // Listeners attached to canvas for better control
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('mouseup', this.handleMouseUp);
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Start Loop
        this.loop();
    }

    resize() {
        this.width = this.canvas.clientWidth;
        this.height = this.canvas.clientHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    initLevel() {
        // Center camera roughly
        this.camera = { x: -500, y: -500 };

        // Player HQ
        const hq = this.createEntity(1000, 1000, EntityType.CONSTRUCTION_YARD, 'player');
        this.buildings.push(hq);
        
        // Ore
        for(let i=0; i<20; i++) {
            this.orePatches.push({
                pos: {
                    x: 1000 + (Math.random()-0.5)*1000, 
                    y: 1000 + (Math.random()-0.5)*1000
                },
                amount: 1000
            });
        }
        
        this.calculatePower();
    }

    createEntity(x: number, y: number, type: EntityType, team: 'player' | 'enemy'): Entity {
        const def = DEFINITIONS[type];
        
        // Snap to grid for buildings
        let posX = x;
        let posY = y;
        if (type in [EntityType.CONSTRUCTION_YARD, EntityType.POWER_PLANT, EntityType.REFINERY, EntityType.BARRACKS, EntityType.FACTORY]) {
            const gx = Math.floor(x / TILE_SIZE);
            const gy = Math.floor(y / TILE_SIZE);
            posX = (gx * TILE_SIZE) + (def.w * TILE_SIZE) / 2;
            posY = (gy * TILE_SIZE) + (def.h * TILE_SIZE) / 2;
        }

        return {
            id: Math.random().toString(36).substr(2, 9),
            pos: { x: posX, y: posY },
            type: type,
            team: team,
            hp: def.hp,
            maxHp: def.hp,
            dead: false,
            radius: def.radius || (Math.max(def.w, def.h) * TILE_SIZE) / 2,
            cargo: 0,
            harvestState: 'idle',
            cooldown: 0,
            turretAngle: 0
        };
    }

    // --- Input Handling ---

    getScreenPos(worldPos: Vector): Vector {
        return { x: worldPos.x + this.camera.x, y: worldPos.y + this.camera.y };
    }

    getWorldPos(screenPos: Vector): Vector {
        return { x: screenPos.x - this.camera.x, y: screenPos.y - this.camera.y };
    }

    handleMouseMove = (e: MouseEvent) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.worldMouse = this.getWorldPos(this.mouse);

        // Panning Logic
        if (this.isPanning) {
            const dx = this.mouse.x - this.dragStartMouse.x;
            const dy = this.mouse.y - this.dragStartMouse.y;
            this.camera.x = this.dragStartCamera.x + dx;
            this.camera.y = this.dragStartCamera.y + dy;
        }
    }

    handleMouseDown = (e: MouseEvent) => {
        if (e.button === 2) { // Right Click
            e.preventDefault();
            this.isPanning = true;
            this.dragStartMouse = { ...this.mouse };
            this.dragStartCamera = { ...this.camera };
        } else if (e.button === 0) { // Left Click
            if (this.buildMode) {
                this.tryPlaceBuilding();
            } else {
                this.isDraggingSelection = true;
                this.selectionStart = { ...this.worldMouse };
            }
        }
    }

    handleMouseUp = (e: MouseEvent) => {
        if (e.button === 2) { // Right Click Release
            this.isPanning = false;
            // If we didn't move much, treat it as a command click
            const dist = Math.sqrt(Math.pow(this.mouse.x - this.dragStartMouse.x, 2) + Math.pow(this.mouse.y - this.dragStartMouse.y, 2));
            if (dist < 5) {
                this.issueCommand();
            }
        } else if (e.button === 0) { // Left Click Release
             if (this.isDraggingSelection) {
                 this.isDraggingSelection = false;
                 this.selectUnits();
             }
        }
    }

    // --- Game Logic ---

    issueCommand() {
        this.buildMode = null;
        this.onUpdateUI?.();

        let target: Entity | null = null;

        // Check if clicked on enemy
        const enemy = this.units.find(u => u.team === 'enemy' && this.dist(u.pos, this.worldMouse) < 20);
        if (enemy) target = enemy;
        
        if (!target) {
            const bld = this.buildings.find(b => b.team === 'enemy' && this.dist(b.pos, this.worldMouse) < 40);
            if (bld) target = bld;
        }

        // Issue command to selected units
        this.units.forEach(u => {
            if (u.selected && u.team === 'player') {
                if (target) {
                    u.targetUnit = target;
                    u.targetPos = null;
                } else {
                    u.targetPos = { ...this.worldMouse };
                    u.targetUnit = null;
                    if (u.type === EntityType.HARVESTER) u.harvestState = 'idle';
                }
                // Feedback particle
                this.particles.push({ pos: { ...this.worldMouse }, vel: { x: 0, y: 0 }, life: 20, color: '#0f0' });
            }
        });
    }

    selectUnits() {
        const x1 = Math.min(this.selectionStart.x, this.worldMouse.x);
        const y1 = Math.min(this.selectionStart.y, this.worldMouse.y);
        const x2 = Math.max(this.selectionStart.x, this.worldMouse.x);
        const y2 = Math.max(this.selectionStart.y, this.worldMouse.y);

        const isClick = (Math.abs(x2 - x1) < 5 && Math.abs(y2 - y1) < 5);

        this.units.forEach(u => {
            if (u.team === 'player') {
                if (isClick) {
                    u.selected = this.dist(u.pos, this.worldMouse) < 20;
                } else {
                    u.selected = (u.pos.x > x1 && u.pos.x < x2 && u.pos.y > y1 && u.pos.y < y2);
                }
            }
        });
        this.onUpdateUI?.();
    }

    tryPlaceBuilding() {
        if (!this.buildMode) return;
        const def = DEFINITIONS[this.buildMode];
        if (this.credits < def.cost) return;

        const gx = Math.floor(this.worldMouse.x / TILE_SIZE);
        const gy = Math.floor(this.worldMouse.y / TILE_SIZE);
        
        // Check overlap (Simplified)
        const checkRect = {
            x: gx * TILE_SIZE,
            y: gy * TILE_SIZE,
            w: def.w * TILE_SIZE,
            h: def.h * TILE_SIZE
        };

        const collision = this.buildings.some(b => {
             const bDef = DEFINITIONS[b.type];
             const bRect = {
                 x: b.pos.x - (bDef.w * TILE_SIZE)/2,
                 y: b.pos.y - (bDef.h * TILE_SIZE)/2,
                 w: bDef.w * TILE_SIZE,
                 h: bDef.h * TILE_SIZE
             };
             return (checkRect.x < bRect.x + bRect.w && checkRect.x + checkRect.w > bRect.x &&
                     checkRect.y < bRect.y + bRect.h && checkRect.y + checkRect.h > bRect.y);
        });

        if (!collision) {
            this.credits -= def.cost;
            const b = this.createEntity(checkRect.x + checkRect.w/2, checkRect.y + checkRect.h/2, this.buildMode, 'player');
            this.buildings.push(b);
            
            if (this.buildMode === EntityType.REFINERY) {
                 this.units.push(this.createEntity(b.pos.x, b.pos.y + 60, EntityType.HARVESTER, 'player'));
            }

            this.buildMode = null;
            this.calculatePower();
            this.onUpdateUI?.();
        } else {
            this.onMessage?.("Cannot build here!");
        }
    }

    dist(v1: Vector, v2: Vector) {
        return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
    }
    
    calculatePower() {
        let produced = 0;
        let consumed = 0;
        this.buildings.filter(b => b.team === 'player').forEach(b => {
            const def = DEFINITIONS[b.type];
            if (def.power > 0) produced += def.power;
            else consumed += Math.abs(def.power);
        });
        this.power = produced - consumed;
        this.onUpdateUI?.();
    }
    
    getNearestEnemy(pos: Vector, range: number): Entity | null {
        let nearest = null;
        let minDst = range;
        
        this.units.forEach(u => {
            if (u.team === 'enemy' && !u.dead) {
                const d = this.dist(pos, u.pos);
                if (d < minDst) { minDst = d; nearest = u; }
            }
        });
        
        if (!nearest) {
            this.buildings.forEach(b => {
                if (b.team === 'enemy' && !b.dead) {
                    const d = this.dist(pos, b.pos);
                    if (d < minDst) { minDst = d; nearest = b; }
                }
            });
        }
        return nearest;
    }

    // --- Main Loop ---

    loop = () => {
        this.update();
        this.draw();
        requestAnimationFrame(this.loop);
    }

    update() {
        this.tick++;

        // 1. Production
        if (this.power >= 0) {
            Object.entries(this.productionQueues).forEach(([key, queue]) => {
                if (queue) {
                    queue.progress += 16;
                    if (queue.progress >= queue.total) {
                        const spawnerType = key === 'barracks' ? EntityType.BARRACKS : EntityType.FACTORY;
                        const spawner = this.buildings.find(b => b.type === spawnerType && b.team === 'player');
                        if (spawner) {
                            this.units.push(this.createEntity(spawner.pos.x, spawner.pos.y + 50, queue.type, 'player'));
                            this.onMessage?.("Unit Ready");
                        }
                        this.productionQueues[key] = null;
                        this.onUpdateUI?.();
                    } else if (this.tick % 10 === 0) {
                        this.onUpdateUI?.(); // Update progress bars
                    }
                }
            });
        }

        // 2. Buildings (Turrets) Logic
        this.buildings.forEach(b => {
            if (b.team === 'player' && b.type === EntityType.CANNON) {
                 if (this.power < 0) return;
                 
                 if (b.cooldown! > 0) {
                     b.cooldown!--;
                 } else {
                     const target = this.getNearestEnemy(b.pos, DEFINITIONS[EntityType.CANNON].range!);
                     if (target) {
                         // Rotate turret
                         b.turretAngle = Math.atan2(target.pos.y - b.pos.y, target.pos.x - b.pos.x);
                         this.fireProjectile(b, target, DEFINITIONS[EntityType.CANNON].damage!);
                         b.cooldown = DEFINITIONS[EntityType.CANNON].fireRate;
                     }
                 }
            }
        });

        // 3. Units Logic
        this.units.forEach(u => {
            const def = DEFINITIONS[u.type];
            
            // Harvester Logic
            if (u.type === EntityType.HARVESTER && u.team === 'player') {
                this.updateHarvester(u);
            }
            
            // AI Logic
            if (u.team === 'enemy' && !u.targetUnit && !u.targetPos) {
                const hq = this.buildings.find(b => b.type === EntityType.CONSTRUCTION_YARD && b.team === 'player');
                if (hq) {
                    u.targetUnit = hq; // Target the actual entity
                }
            }

            // Auto-Targeting for Idle Units
            if (!u.targetUnit && !u.targetPos && u.type !== EntityType.HARVESTER) {
                 const target = this.getNearestEnemy(u.pos, def.range || 150);
                 if (target) u.targetUnit = target;
            }

            // Movement & Attack
            let moveTarget = u.targetPos;
            
            if (u.targetUnit) {
                if (u.targetUnit.dead) {
                    u.targetUnit = null;
                } else {
                    const d = this.dist(u.pos, u.targetUnit.pos);
                    if (d <= (def.range || 0)) {
                        moveTarget = null;
                        // Face target
                        u.turretAngle = Math.atan2(u.targetUnit.pos.y - u.pos.y, u.targetUnit.pos.x - u.pos.x);
                        
                        if (u.cooldown! <= 0) {
                            this.fireProjectile(u, u.targetUnit, def.damage || 0);
                            u.cooldown = def.fireRate;
                        }
                    } else {
                        moveTarget = u.targetUnit.pos;
                    }
                }
            }

            if (u.cooldown! > 0) u.cooldown!--;

            if (moveTarget) {
                const dx = moveTarget.x - u.pos.x;
                const dy = moveTarget.y - u.pos.y;
                const d = Math.sqrt(dx*dx + dy*dy);
                const speed = def.speed || 1;
                
                if (d > speed) {
                    // Simple repulsion
                    let rx = 0, ry = 0;
                    this.units.forEach(other => {
                        if (u !== other) {
                            const od = this.dist(u.pos, other.pos);
                            if (od < 20) {
                                rx += (u.pos.x - other.pos.x);
                                ry += (u.pos.y - other.pos.y);
                            }
                        }
                    });

                    u.pos.x += (dx/d) * speed + rx * 0.05;
                    u.pos.y += (dy/d) * speed + ry * 0.05;
                } else {
                    if (!u.targetUnit) u.targetPos = null;
                }
            }
        });

        // 4. Projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            const dx = p.target.pos.x - p.pos.x;
            const dy = p.target.pos.y - p.pos.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            
            if (d < 10) {
                p.target.hp -= p.damage;
                if (p.target.hp <= 0) p.target.dead = true;
                this.particles.push({ pos: { ...p.target.pos }, vel: { x:0, y:0 }, life: 10, color: 'orange' });
                this.projectiles.splice(i, 1);
            } else {
                p.pos.x += (dx/d) * 10;
                p.pos.y += (dy/d) * 10;
            }
        }

        // 5. Cleanup
        this.units = this.units.filter(u => !u.dead);
        this.buildings = this.buildings.filter(b => !b.dead);
        this.particles = this.particles.filter(p => p.life > 0);
        this.particles.forEach(p => p.life--);

        // 6. Wave Logic (Every 90s = 5400 ticks)
        // Spawn first wave at 90s.
        if (this.tick % 5400 === 0 && this.tick > 0) { 
            this.onMessage?.(`Wave ${this.wave} Incoming!`);
            const count = Math.floor(this.wave * 1.5) + 2; // Slightly easier scaling
            for(let i=0; i<count; i++) {
                const x = 2000;
                const y = 1000 + (Math.random() - 0.5) * 500;
                this.units.push(this.createEntity(x, y, i % 3 === 0 ? EntityType.TANK : EntityType.INFANTRY, 'enemy'));
            }
            this.wave++;
            this.onUpdateUI?.();
        }

        // 7. Win/Loss
        const hq = this.buildings.find(b => b.type === EntityType.CONSTRUCTION_YARD && b.team === 'player');
        if (!hq && this.onGameOver) this.onGameOver(); 
    }

    fireProjectile(source: Entity, target: Entity, damage: number) {
        this.projectiles.push({
            pos: { ...source.pos },
            target: target,
            damage: damage
        });
    }

    updateHarvester(u: Entity) {
        const def = DEFINITIONS[EntityType.HARVESTER];
        const cap = def.capacity || 500;
        
        if (u.cargo! >= cap) {
            u.harvestState = 'returning';
            const refinery = this.buildings.find(b => b.type === EntityType.REFINERY && b.team === 'player');
            if (refinery) {
                u.targetPos = refinery.pos;
                if (this.dist(u.pos, refinery.pos) < 60) {
                    this.credits += u.cargo!;
                    this.onMessage?.(`+${u.cargo} Credits`);
                    u.cargo = 0;
                    u.harvestState = 'idle';
                    this.onUpdateUI?.();
                }
            }
        } else if (u.harvestState === 'idle' || u.harvestState === 'moving_to_ore') {
            const ore = this.orePatches[0]; // Simplified finding
            if (ore) {
                u.targetPos = ore.pos;
                u.harvestState = 'moving_to_ore';
                if (this.dist(u.pos, ore.pos) < 30) {
                    u.harvestState = 'harvesting';
                    u.targetPos = null;
                }
            }
        } else if (u.harvestState === 'harvesting') {
            if (this.tick % 10 === 0) {
                u.cargo! += 10;
                this.particles.push({ pos: { ...u.pos }, vel: { x:0, y:-1 }, life: 10, color: '#0f0' });
                if (u.cargo! >= cap) u.harvestState = 'returning';
            }
        }
    }

    // --- Rendering ---

    draw() {
        // Clear screen
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // --- World Space ---
        this.ctx.save();
        this.ctx.translate(this.camera.x, this.camera.y);

        // 1. Grid
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        const startCol = Math.floor(-this.camera.x / TILE_SIZE);
        const endCol = startCol + (this.width / TILE_SIZE) + 1;
        const startRow = Math.floor(-this.camera.y / TILE_SIZE);
        const endRow = startRow + (this.height / TILE_SIZE) + 1;

        this.ctx.beginPath();
        for (let x = startCol; x <= endCol; x++) {
            this.ctx.moveTo(x * TILE_SIZE, startRow * TILE_SIZE);
            this.ctx.lineTo(x * TILE_SIZE, endRow * TILE_SIZE);
        }
        for (let y = startRow; y <= endRow; y++) {
            this.ctx.moveTo(startCol * TILE_SIZE, y * TILE_SIZE);
            this.ctx.lineTo(endCol * TILE_SIZE, y * TILE_SIZE);
        }
        this.ctx.stroke();

        // 2. Ore
        this.ctx.fillStyle = COLORS.ore;
        this.orePatches.forEach(o => {
            this.ctx.beginPath();
            this.ctx.arc(o.pos.x, o.pos.y, 15, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // 3. Buildings Body
        this.buildings.forEach(b => this.drawEntityBody(b));

        // 4. Units Body
        this.units.forEach(u => this.drawEntityBody(u));

        // 5. Projectiles
        this.ctx.fillStyle = 'yellow';
        this.projectiles.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.pos.x, p.pos.y, 3, 0, Math.PI*2);
            this.ctx.fill();
        });

        // 6. Particles
        this.particles.forEach(p => {
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.life / 20;
            this.ctx.fillRect(p.pos.x, p.pos.y, 3, 3);
        });
        this.ctx.globalAlpha = 1;

        // 7. Overlays & Health Bars (Drawn LAST)
        this.buildings.forEach(b => this.drawEntityOverlay(b));
        this.units.forEach(u => this.drawEntityOverlay(u));

        // 8. Selection Box
        if (this.isDraggingSelection) {
            this.ctx.strokeStyle = '#fff';
            this.ctx.strokeRect(this.selectionStart.x, this.selectionStart.y, this.worldMouse.x - this.selectionStart.x, this.worldMouse.y - this.selectionStart.y);
        }

        // 9. Ghost Building
        if (this.buildMode) {
            const def = DEFINITIONS[this.buildMode];
            const gx = Math.floor(this.worldMouse.x / TILE_SIZE) * TILE_SIZE;
            const gy = Math.floor(this.worldMouse.y / TILE_SIZE) * TILE_SIZE;
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            this.ctx.strokeStyle = '#0f0';
            this.ctx.lineWidth = 2;
            this.ctx.fillRect(gx, gy, def.w * TILE_SIZE, def.h * TILE_SIZE);
            this.ctx.strokeRect(gx, gy, def.w * TILE_SIZE, def.h * TILE_SIZE);
        }

        this.ctx.restore();
        // --- End World Space ---
    }

    drawEntityBody(e: Entity) {
        const def = DEFINITIONS[e.type];
        const x = e.pos.x;
        const y = e.pos.y;
        const w = def.w * TILE_SIZE;
        const h = def.h * TILE_SIZE;

        // Setup Text Properties
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        if (e.type === EntityType.CONSTRUCTION_YARD) {
            this.ctx.fillStyle = '#222';
            this.ctx.fillRect(x - w/2, y - h/2, w, h);
            this.ctx.strokeStyle = COLORS.player;
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x - w/2, y - h/2, w, h);
            
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 16px sans-serif';
            this.ctx.fillText("HQ", x, y);
        } 
        else if (e.type === EntityType.POWER_PLANT) {
            this.ctx.fillStyle = '#222';
            this.ctx.fillRect(x - w/2, y - h/2, w, h);
            this.ctx.strokeStyle = '#eab308'; // yellow
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x - w/2, y - h/2, w, h);

            this.ctx.fillStyle = '#eab308';
            this.ctx.font = '24px sans-serif';
            this.ctx.fillText("⚡", x, y);
        } 
        else if (e.type === EntityType.REFINERY) {
            this.ctx.fillStyle = '#222';
            this.ctx.fillRect(x - w/2, y - h/2, w, h);
            this.ctx.strokeStyle = '#22c55e'; // green
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x - w/2, y - h/2, w, h);

            this.ctx.fillStyle = '#22c55e';
            this.ctx.font = '24px sans-serif';
            this.ctx.fillText("💰", x, y);
        } 
        else if (e.type === EntityType.BARRACKS) {
             this.ctx.fillStyle = '#333';
             this.ctx.fillRect(x - w/2, y - h/2, w, h);
             this.ctx.strokeStyle = '#9ca3af'; // gray
             this.ctx.lineWidth = 2;
             this.ctx.strokeRect(x - w/2, y - h/2, w, h);

             this.ctx.fillStyle = '#fff';
             this.ctx.font = '24px sans-serif';
             this.ctx.fillText("⛺", x, y);
        } 
        else if (e.type === EntityType.FACTORY) {
            this.ctx.fillStyle = '#333';
            this.ctx.fillRect(x - w/2, y - h/2, w, h);
            this.ctx.strokeStyle = '#9ca3af'; // gray
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x - w/2, y - h/2, w, h);

            this.ctx.fillStyle = '#fff';
            this.ctx.font = '24px sans-serif';
            this.ctx.fillText("🏭", x, y);
        } 
        else if (e.type === EntityType.CANNON) {
            // Base
            this.ctx.fillStyle = '#222';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 15, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.strokeStyle = COLORS.player;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Turret Barrel
            this.ctx.save();
            this.ctx.translate(x, y);
            this.ctx.rotate(e.turretAngle || 0);
            this.ctx.fillStyle = '#444';
            this.ctx.fillRect(0, -4, 30, 8);
            this.ctx.restore();
        } 
        else if (e.type === EntityType.TANK) {
            // Tank Body (Square with treads)
            this.ctx.fillStyle = '#111'; // Treads bg
            this.ctx.fillRect(x - 14, y - 12, 28, 24);
            
            // Treads details
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(x - 14, y - 12, 6, 24); // Left Tread
            this.ctx.fillRect(x + 8, y - 12, 6, 24); // Right Tread
            
            // Main Body (Team Color)
            this.ctx.fillStyle = e.team === 'player' ? COLORS.player : COLORS.enemy;
            this.ctx.fillRect(x - 8, y - 10, 16, 20);

            // Turret (Circle)
            this.ctx.fillStyle = '#444';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 8, 0, Math.PI*2);
            this.ctx.fill();
            
            // Gun Barrel
            this.ctx.save();
            this.ctx.translate(x, y);
            this.ctx.rotate(e.turretAngle || 0); 
            this.ctx.fillRect(0, -3, 20, 6);
            this.ctx.restore();
        } 
        else if (e.type === EntityType.INFANTRY) {
            // Infantry Body
            this.ctx.fillStyle = e.team === 'player' ? COLORS.player : COLORS.enemy;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 5, 0, Math.PI*2);
            this.ctx.fill();
            
            // Head/Helmet
            this.ctx.fillStyle = '#ddd';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 2.5, 0, Math.PI*2);
            this.ctx.fill();

            // Gun Line
            this.ctx.strokeStyle = '#999';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            if (e.targetUnit) {
                 const angle = Math.atan2(e.targetUnit.pos.y - y, e.targetUnit.pos.x - x);
                 this.ctx.lineTo(x + Math.cos(angle)*12, y + Math.sin(angle)*12);
            } else {
                 this.ctx.lineTo(x + 12, y);
            }
            this.ctx.stroke();
        } 
        else if (e.type === EntityType.HARVESTER) {
             this.ctx.fillStyle = '#eab308';
             this.ctx.fillRect(x - 12, y - 10, 24, 20);
             this.ctx.strokeStyle = '#000';
             this.ctx.strokeRect(x-12, y-10, 24, 20);
        } else {
            // Fallback
            this.ctx.fillRect(x - w/2, y - h/2, w, h);
        }
    }

    drawEntityOverlay(e: Entity) {
        const x = e.pos.x;
        const y = e.pos.y;

        // Selection Ring
        if (e.selected) {
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(x, y, e.radius + 5, 0, Math.PI*2);
            this.ctx.stroke();
        }

        // Health Bar Logic
        const isBuilding = [
            EntityType.CONSTRUCTION_YARD, EntityType.POWER_PLANT, 
            EntityType.REFINERY, EntityType.BARRACKS, 
            EntityType.FACTORY, EntityType.CANNON
        ].includes(e.type);

        // Show if damaged OR selected OR is a building
        if (e.hp < e.maxHp || e.selected || isBuilding) {
            const w = Math.max(32, e.radius * 1.5);
            const h = 6;
            const barY = y - e.radius - 15;

            // Draw High Contrast Border
            this.ctx.fillStyle = 'rgba(0,0,0,0.8)';
            this.ctx.fillRect(x - w/2 - 1, barY - 1, w + 2, h + 2);

            // Background
            this.ctx.fillStyle = '#333';
            this.ctx.fillRect(x - w/2, barY, w, h);
            
            // HP Color
            const pct = Math.max(0, e.hp / e.maxHp);
            this.ctx.fillStyle = pct > 0.5 ? '#00ff00' : (pct > 0.25 ? '#ffff00' : '#ff0000');
            this.ctx.fillRect(x - w/2, barY, w * pct, h);

            // Border
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x - w/2, barY, w, h);
        }
        
        // Harvester Cargo Indicator
        if (e.type === EntityType.HARVESTER && e.cargo! > 0) {
             const def = DEFINITIONS[EntityType.HARVESTER];
             const w = 20;
             this.ctx.fillStyle = '#0f0';
             this.ctx.fillRect(x - w/2, y + 8, w * (e.cargo! / def.capacity!), 3);
        }
    }
}