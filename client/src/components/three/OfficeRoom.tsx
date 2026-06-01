import { Html, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { FURNITURE_MODELS } from "@/lib/assets";
import { SCENE_FLOW_ZONES } from "@/lib/scene-stage-flow";
import {
  FUTURE_DEPARTMENT_COLORS,
  FUTURE_OFFICE_COLORS,
  rethemeFurnitureMaterial,
} from "@/lib/scene-theme";
import { useAppStore } from "@/lib/store";
import { useWorkflowStore } from "@/lib/workflow-store";
import { selectWorkflowOrganization } from "@/lib/workflow-selectors";

import type { SceneFusionMode } from "./scene-fusion/role-id-bridge";

type SceneDepartmentInfo = {
  id: string;
  title: string;
  subtitle: string;
  zoneLabel: string;
  color: string;
};

const SCENE_DEPARTMENT_COLORS = FUTURE_DEPARTMENT_COLORS;

function getPodLabel(index: number, locale: "zh-CN" | "en-US") {
  const suffix = String.fromCharCode(65 + index);
  return locale === "zh-CN" ? `临时战区 ${suffix}` : `Pod ${suffix}`;
}

function getScenePodTitle(index: number, locale: "zh-CN" | "en-US") {
  const suffix = String.fromCharCode(65 + index);
  return locale === "zh-CN" ? `战区 ${suffix}` : `Pod ${suffix}`;
}

function getFallbackPodSubtitle(index: number, locale: "zh-CN" | "en-US") {
  const zhSubtitles = [
    "策略集结单元",
    "能力装配单元",
    "协作推进单元",
    "复核汇总单元",
  ];
  const enSubtitles = [
    "Strategy Rally Cell",
    "Capability Assembly Cell",
    "Execution Push Cell",
    "Review Wrap-up Cell",
  ];
  return locale === "zh-CN"
    ? zhSubtitles[index] || "动态编组"
    : enSubtitles[index] || "Dynamic Team";
}

function toShortLabel(value: string, fallback: string) {
  const text = (value || fallback).trim();
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

function FurnitureModel({
  url,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  centerXZ = false,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  centerXZ?: boolean;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    const center = bounds.getCenter(new THREE.Vector3());

    next.position.y -= minY;
    if (centerXZ) {
      next.position.x -= center.x;
      next.position.z -= center.z;
    }

    next.traverse(child => {
      if (!("isMesh" in child) || !child.isMesh) return;

      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (!mesh.material) return;

      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(material => material.clone())
        : mesh.material.clone();

      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        rethemeFurnitureMaterial(material, mesh.name, url);
      }
    });
    return next;
  }, [centerXZ, scene]);

  return (
    <primitive
      object={cloned}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
}

function Floor({ showFloorLines = true }: { showFloorLines?: boolean }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[18, 14]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.floorBase}
          roughness={0.84}
          metalness={0.02}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        receiveShadow
      >
        <planeGeometry args={[14.8, 10.6]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.floorInset}
          roughness={0.82}
          metalness={0.04}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.004, 0]}
        receiveShadow
      >
        <planeGeometry args={[11.8, 7.8]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.floorGlass}
          roughness={0.56}
          metalness={0.08}
          transparent
          opacity={0.58}
        />
      </mesh>

      {/* whybuddy-3d-real-role-driven-scene-2026-05-29: the thin slate floor
          lines read as a stray "black line" in the blueprint scene, so they
          are suppressed there (showFloorLines = false). Mission-first keeps
          them as part of its cool-office floor inlay. */}
      {showFloorLines ? (
        <>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.006, -4.42]}
            receiveShadow
          >
            <planeGeometry args={[15.1, 0.85]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.floorLine}
              transparent
              opacity={0.1}
            />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, Math.PI / 2, 0]}
            position={[-7.38, 0.006, 0]}
            receiveShadow
          >
            <planeGeometry args={[9.6, 0.78]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.floorLine}
              transparent
              opacity={0.08}
            />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, -Math.PI / 2, 0]}
            position={[7.38, 0.006, 0]}
            receiveShadow
          >
            <planeGeometry args={[9.6, 0.78]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.floorLine}
              transparent
              opacity={0.07}
            />
          </mesh>
        </>
      ) : null}

      {[
        [-5.8, 0.01, -4.15],
        [-1.9, 0.01, -4.15],
        [1.9, 0.01, -4.15],
        [5.8, 0.01, -4.15],
      ].map((position, index) => (
        <FurnitureModel
          key={`floor-back-${index}`}
          url={FURNITURE_MODELS.floorFull}
          position={position as [number, number, number]}
          scale={1.02}
        />
      ))}

      {[
        [-6.95, 0.01, -2.05, Math.PI / 2],
        [-6.95, 0.01, 1.75, Math.PI / 2],
        [6.95, 0.01, -2.05, -Math.PI / 2],
        [6.95, 0.01, 1.75, -Math.PI / 2],
      ].map(([x, y, z, ry], index) => (
        <FurnitureModel
          key={`floor-side-${index}`}
          url={FURNITURE_MODELS.floorHalf}
          position={[x, y, z]}
          rotation={[0, ry, 0]}
          scale={1.02}
        />
      ))}

      <FurnitureModel
        url={FURNITURE_MODELS.floorCornerRound}
        position={[-6.95, 0.01, -4.15]}
        rotation={[0, Math.PI / 2, 0]}
        scale={1.05}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.floorCornerRound}
        position={[6.95, 0.01, -4.15]}
        rotation={[0, Math.PI, 0]}
        scale={1.05}
      />
    </>
  );
}

function Walls() {
  return (
    <group>
      <mesh position={[0, 1.5, -4.9]} receiveShadow>
        <boxGeometry args={[15.42, 3, 0.18]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wall}
          roughness={0.9}
        />
      </mesh>
      <mesh
        position={[-7.8, 1.5, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[9.98, 3, 0.18]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wallSide}
          roughness={0.92}
        />
      </mesh>
      <mesh
        position={[7.8, 1.5, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[9.98, 3, 0.18]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wallSide}
          roughness={0.92}
        />
      </mesh>

      <mesh position={[0, 0.42, -4.79]} receiveShadow>
        <boxGeometry args={[15.2, 0.56, 0.05]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wallTrim}
          roughness={1}
          transparent
          opacity={0.62}
        />
      </mesh>
      <mesh
        position={[-7.7, 0.42, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[9.6, 0.56, 0.05]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wallTrim}
          roughness={1}
          transparent
          opacity={0.56}
        />
      </mesh>
      <mesh
        position={[7.7, 0.42, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <boxGeometry args={[9.6, 0.56, 0.05]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.wallTrim}
          roughness={1}
          transparent
          opacity={0.56}
        />
      </mesh>

      <FurnitureModel
        url={FURNITURE_MODELS.wallCorner}
        position={[-7.72, 0, -4.82]}
        rotation={[0, Math.PI / 2, 0]}
        scale={1.08}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.wallCornerRond}
        position={[7.72, 0, -4.82]}
        rotation={[0, Math.PI, 0]}
        scale={1.08}
      />
    </group>
  );
}

function ArchitecturalAccents({ showLamps = true }: { showLamps?: boolean }) {
  return (
    <group>
      <FurnitureModel
        url={FURNITURE_MODELS.wallDoorwayWide}
        position={[7.65, 0, -2.9]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={1.06}
      />

      <FurnitureModel
        url={FURNITURE_MODELS.coatRackStanding}
        position={[6.55, 0, -1.35]}
        rotation={[0, -Math.PI / 3, 0]}
      />

      {/* whybuddy-3d-real-role-driven-scene-2026-05-29: the standing floor lamp
          + wall lamp (and their point lights) read as a stray "floating lamp"
          in the blueprint scene, so they are suppressed there. Mission-first
          keeps them as part of its decorated office. */}
      {showLamps ? (
        <>
          <FurnitureModel
            url={FURNITURE_MODELS.lampRoundFloor}
            position={[-6.3, 0, 0.6]}
            rotation={[0, Math.PI / 6, 0]}
          />

          <pointLight
            position={[-6.15, 1.85, 0.65]}
            intensity={0.32}
            color={FUTURE_OFFICE_COLORS.practicalLight}
            distance={4.6}
            decay={2}
          />

          <FurnitureModel
            url={FURNITURE_MODELS.lampWall}
            position={[0, 1.08, -4.72]}
            scale={1.05}
          />
          <pointLight
            position={[0, 1.22, -4.4]}
            intensity={0.16}
            color={FUTURE_OFFICE_COLORS.cyanSoft}
            distance={3}
            decay={2}
          />
        </>
      ) : null}
    </group>
  );
}

function CorkBoard() {
  return (
    <group position={[0, 2.02, -4.72]}>
      <mesh>
        <boxGeometry args={[2.7, 1.16, 0.06]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.panel}
          roughness={0.74}
          metalness={0.04}
        />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[2.86, 1.29, 0.03]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.panelFrame}
          roughness={0.58}
          metalness={0.08}
        />
      </mesh>
      {[
        {
          pos: [-0.62, 0.12, 0.05] as [number, number, number],
          color: FUTURE_OFFICE_COLORS.paper,
          rot: 0.04,
        },
        {
          pos: [0.54, -0.08, 0.05] as [number, number, number],
          color: FUTURE_OFFICE_COLORS.rug,
          rot: -0.04,
        },
      ].map((note, index) => (
        <mesh key={index} position={note.pos} rotation={[0, 0, note.rot]}>
          <planeGeometry args={[0.54, 0.4]} />
          <meshStandardMaterial color={note.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function ZoneBase({
  position,
  color,
}: {
  position: [number, number, number];
  color: string;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[4.2, 3.3]} />
        <meshStandardMaterial color={color} transparent opacity={0.13} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -1.46]}>
        <planeGeometry args={[1.48, 0.1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.12}
          transparent
          opacity={0.28}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, -1.46]}>
        <planeGeometry args={[0.92, 0.04]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.paper}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  );
}

const POD_SLOTS = [
  {
    floorPosition: [-3.45, 0.03, -1.78] as [number, number, number],
    decorPosition: [-5.15, 0, -1.95] as [number, number, number],
    glassPosition: [-4.52, 1.02, -1.02] as [number, number, number],
    storagePosition: [-4.92, 0, -2.9] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    floorPosition: [3.35, 0.03, -1.72] as [number, number, number],
    decorPosition: [5.3, 0, -1.8] as [number, number, number],
    glassPosition: [4.9, 1.06, -0.98] as [number, number, number],
    storagePosition: [5.92, 0, -2.78] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    floorPosition: [-3.08, 0.03, 2.45] as [number, number, number],
    decorPosition: [-5.08, 0, 2.68] as [number, number, number],
    glassPosition: [-4.48, 1.02, 2.96] as [number, number, number],
    storagePosition: [-4.92, 0, 3.02] as [number, number, number],
    storageRotation: [0, 0, 0] as [number, number, number],
  },
  {
    floorPosition: [3.25, 0.03, 2.45] as [number, number, number],
    decorPosition: [5.25, 0, 2.58] as [number, number, number],
    glassPosition: [4.86, 1.04, 2.04] as [number, number, number],
    storagePosition: [5.94, 0, 1.55] as [number, number, number],
    storageRotation: [0, -Math.PI / 2, 0] as [number, number, number],
  },
];

function PodDecor({
  slotIndex,
  title,
  subtitle,
  color,
}: SceneDepartmentInfo & { slotIndex: number }) {
  const slot = POD_SLOTS[slotIndex];
  if (!slot) return null;

  const ringRadius = 1.04 + slotIndex * 0.05;
  const cardColors = [
    FUTURE_OFFICE_COLORS.paper,
    FUTURE_OFFICE_COLORS.rug,
    "#E8F8F4",
    "#F1EDFF",
  ];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={slot.floorPosition}>
        <torusGeometry args={[ringRadius, 0.055, 16, 64]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.14}
          transparent
          opacity={0.78}
        />
      </mesh>

      <group position={slot.decorPosition}>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.58, 0.16, 0.44]} />
          <meshStandardMaterial
            color={FUTURE_OFFICE_COLORS.furnitureTrim}
            roughness={0.7}
            metalness={0.08}
          />
        </mesh>
        {[-0.14, 0.02, 0.18].map((x, index) => (
          <mesh
            key={index}
            position={[x, 0.26 + index * 0.05, -0.06 + index * 0.06]}
          >
            <boxGeometry args={[0.26, 0.04, 0.18]} />
            <meshStandardMaterial
              color={cardColors[(slotIndex + index) % cardColors.length]}
              roughness={0.72}
            />
          </mesh>
        ))}
        <mesh position={[0.24, 0.28, -0.04]}>
          <cylinderGeometry args={[0.055, 0.055, 0.1, 18]} />
          <meshStandardMaterial
            color={FUTURE_OFFICE_COLORS.paper}
            emissive={color}
            emissiveIntensity={0.18}
            roughness={0.42}
          />
        </mesh>
      </group>

      <group
        position={slot.glassPosition}
        rotation={[0, slotIndex % 2 === 0 ? Math.PI / 16 : -Math.PI / 16, 0]}
      >
        <mesh>
          <boxGeometry args={[0.92, 0.68, 0.05]} />
          <meshStandardMaterial
            color={FUTURE_OFFICE_COLORS.panel}
            transparent
            opacity={0.32}
            metalness={0.12}
            roughness={0.25}
          />
        </mesh>
        {[-0.2, 0, 0.2].map(y => (
          <mesh key={y} position={[0, y, 0.03]}>
            <boxGeometry args={[0.58, 0.02, 0.02]} />
            <meshStandardMaterial
              color="#FFFFFF"
              emissive={color}
              emissiveIntensity={0.38}
            />
          </mesh>
        ))}
      </group>

      <FurnitureModel
        url={
          slotIndex >= 2
            ? FURNITURE_MODELS.bookcaseOpenLow
            : FURNITURE_MODELS.sideTable
        }
        position={slot.storagePosition}
        rotation={slot.storageRotation}
        scale={slotIndex >= 2 ? 0.92 : 0.88}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.books}
        position={[
          slot.storagePosition[0],
          slot.storagePosition[1] + (slotIndex >= 2 ? 0.48 : 0.34),
          slot.storagePosition[2],
        ]}
        rotation={slot.storageRotation}
        scale={slotIndex >= 2 ? 0.68 : 0.74}
        centerXZ
      />
    </group>
  );
}

function DepartmentDecor({
  departments,
}: {
  departments: SceneDepartmentInfo[];
}) {
  const slots = departments.slice(0, 4);
  return (
    <group>
      {slots.map((department, index) => (
        <PodDecor key={department.id} slotIndex={index} {...department} />
      ))}
    </group>
  );
}

function DesktopDesk({
  position,
  rotation = [0, 0, 0],
  compact = false,
  withLamp = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  compact?: boolean;
  withLamp?: boolean;
}) {
  const chairOffsetZ = compact ? 0.72 : 0.82;
  const screenOffsetZ = compact ? 0.02 : -0.02;
  const keyboardOffsetZ = compact ? 0.24 : 0.2;
  // The normalized Kenney desk top sits at roughly y=0.384.
  const desktopSurfaceY = 0.392;

  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.desk} centerXZ />
      <FurnitureModel
        url={FURNITURE_MODELS.chairDesk}
        position={[0, 0, chairOffsetZ]}
        rotation={[0, Math.PI, 0]}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.computerScreen}
        position={[0, desktopSurfaceY, screenOffsetZ]}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.computerKeyboard}
        position={[0, desktopSurfaceY, keyboardOffsetZ]}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.computerMouse}
        position={[0.22, desktopSurfaceY, keyboardOffsetZ]}
        centerXZ
      />
      {withLamp && (
        <FurnitureModel
          url={FURNITURE_MODELS.lampRoundTable}
          position={[-0.24, desktopSurfaceY, 0.04]}
          centerXZ
        />
      )}
    </group>
  );
}

function LaptopDesk({
  position,
  rotation = [0, 0, 0],
  showLamp = true,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  showLamp?: boolean;
}) {
  const desktopSurfaceY = 0.392;

  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.desk} centerXZ />
      <FurnitureModel
        url={FURNITURE_MODELS.chairDesk}
        position={[0, 0, 0.82]}
        rotation={[0, Math.PI, 0]}
        centerXZ
      />
      <FurnitureModel
        url={FURNITURE_MODELS.laptop}
        position={[0, desktopSurfaceY, 0.08]}
        centerXZ
      />
      {showLamp ? (
        <FurnitureModel
          url={FURNITURE_MODELS.lampRoundTable}
          position={[0.24, desktopSurfaceY, 0.04]}
          centerXZ
        />
      ) : null}
    </group>
  );
}

function MeetingSet({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel url={FURNITURE_MODELS.tableRound} />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[0.95, 0, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[-0.95, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[0, 0, 0.95]}
        rotation={[0, Math.PI, 0]}
      />
    </group>
  );
}

function LoungeArea({
  position,
  showLamp = true,
}: {
  position: [number, number, number];
  showLamp?: boolean;
}) {
  return (
    <group position={position}>
      <FurnitureModel
        url={FURNITURE_MODELS.loungeSofaLong}
        rotation={[0, Math.PI, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.loungeChair}
        position={[1.6, 0, 0.15]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.tableCoffeeSquare}
        position={[0.8, 0, 1.2]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.sideTable}
        position={[-1.45, 0, 0.3]}
      />
      {showLamp ? (
        <FurnitureModel
          url={FURNITURE_MODELS.lampRoundTable}
          position={[-1.45, 0.7, 0.3]}
        />
      ) : null}
    </group>
  );
}

function StorageColumn({
  position,
  rotation = [0, 0, 0],
  low = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  low?: boolean;
}) {
  return (
    <group position={position} rotation={rotation}>
      <FurnitureModel
        url={
          low ? FURNITURE_MODELS.bookcaseOpenLow : FURNITURE_MODELS.bookcaseOpen
        }
      />
      <FurnitureModel
        url={FURNITURE_MODELS.books}
        position={[0, low ? 0.5 : 0.55, 0]}
      />
      {!low && (
        <FurnitureModel url={FURNITURE_MODELS.books} position={[0, 1.05, 0]} />
      )}
    </group>
  );
}

function MobileBoard({
  position,
  rotation = [0, 0, 0],
  color,
  title,
  subtitle,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  title: string;
  subtitle: string;
}) {
  const glowTextShadow = `0 0 8px ${color}, 0 0 16px ${color}, 0 0 28px rgba(255,255,255,0.7)`;

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 1.02, 0]}>
        <boxGeometry args={[1.18, 0.88, 0.05]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.panel}
          roughness={0.72}
          metalness={0.06}
        />
      </mesh>
      <mesh position={[0, 1.48, 0.012]}>
        <boxGeometry args={[1.18, 0.08, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.56} />
      </mesh>
      <mesh position={[-0.48, 0.58, 0]}>
        <boxGeometry args={[0.06, 1.12, 0.06]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.furnitureTrim}
          roughness={0.62}
          metalness={0.12}
        />
      </mesh>
      <mesh position={[0.48, 0.58, 0]}>
        <boxGeometry args={[0.06, 1.12, 0.06]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.furnitureTrim}
          roughness={0.62}
          metalness={0.12}
        />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.94, 0.05, 0.34]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.furnitureTrim}
          roughness={0.62}
          metalness={0.12}
        />
      </mesh>
      <mesh position={[0, 1.18, 0.027]}>
        <planeGeometry args={[0.84, 0.28]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.floorGlass}
          emissive={color}
          emissiveIntensity={0.18}
          transparent
          opacity={0.2}
        />
      </mesh>
      <mesh position={[0, 0.96, 0.027]}>
        <planeGeometry args={[0.76, 0.16]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.floorGlass}
          emissive={color}
          emissiveIntensity={0.22}
          transparent
          opacity={0.14}
        />
      </mesh>
      <mesh position={[0, 1.31, 0.028]}>
        <planeGeometry args={[0.7, 0.016]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.86}
          transparent
          opacity={0.78}
        />
      </mesh>
      <mesh position={[0, 0.84, 0.028]}>
        <planeGeometry args={[0.62, 0.012]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          transparent
          opacity={0.6}
        />
      </mesh>
      <Html
        center
        transform
        position={[0, 1.09, 0.032]}
        distanceFactor={8.8}
        style={{ pointerEvents: "none" }}
      >
        <div className="w-[158px] text-center">
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/90"
            style={{
              fontFamily: "'DM Sans', 'Noto Sans SC', system-ui, sans-serif",
              textShadow: glowTextShadow,
            }}
          >
            {title}
          </div>
          <div
            className="mt-2 text-[16px] font-black leading-[1.08] tracking-[0.08em] text-white"
            style={{
              fontFamily: "'DM Sans', 'Noto Sans SC', system-ui, sans-serif",
              textShadow: `${glowTextShadow}, 0 2px 10px rgba(15,23,42,0.35)`,
            }}
          >
            {subtitle}
          </div>
        </div>
      </Html>
      {[-0.36, 0.36]
        .flatMap(x => [-0.12, 0.12].map(z => ({ x, z })))
        .map(({ x, z }) => (
          <mesh key={`${x}-${z}`} position={[x, 0.02, z]}>
            <cylinderGeometry args={[0.045, 0.045, 0.04, 18]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.furnitureTrim}
              roughness={0.52}
              metalness={0.18}
            />
          </mesh>
        ))}
      {[
        {
          position: [-0.24, 0.76, 0.03] as [number, number, number],
          noteColor: FUTURE_OFFICE_COLORS.paper,
          rotationZ: -0.08,
        },
        {
          position: [0.12, 0.66, 0.03] as [number, number, number],
          noteColor: FUTURE_OFFICE_COLORS.rug,
          rotationZ: 0.05,
        },
        {
          position: [0.24, 0.9, 0.03] as [number, number, number],
          noteColor: "#F1EDFF",
          rotationZ: -0.04,
        },
      ].map((note, index) => (
        <mesh
          key={index}
          position={note.position}
          rotation={[0, 0, note.rotationZ]}
        >
          <planeGeometry args={[0.18, 0.13]} />
          <meshStandardMaterial color={note.noteColor} roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function TaskCart({
  position,
  rotation = [0, 0, 0],
  color,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.68, 0.08, 0.46]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.furniture}
          roughness={0.72}
          metalness={0.08}
        />
      </mesh>
      <mesh position={[0, 0.74, 0]}>
        <boxGeometry args={[0.68, 0.08, 0.46]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.furnitureAlt}
          roughness={0.72}
          metalness={0.08}
        />
      </mesh>
      {[-0.26, 0.26]
        .flatMap(x => [-0.16, 0.16].map(z => ({ x, z })))
        .map(({ x, z }) => (
          <mesh key={`${x}-${z}`} position={[x, 0.38, z]}>
            <boxGeometry args={[0.04, 0.74, 0.04]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.furnitureTrim}
              roughness={0.66}
              metalness={0.12}
            />
          </mesh>
        ))}
      <mesh position={[0.05, 0.82, 0.04]}>
        <boxGeometry args={[0.28, 0.12, 0.18]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh position={[-0.17, 0.82, -0.06]}>
        <boxGeometry args={[0.12, 0.18, 0.12]} />
        <meshStandardMaterial
          color={FUTURE_OFFICE_COLORS.paper}
          roughness={0.5}
        />
      </mesh>
      <FurnitureModel
        url={FURNITURE_MODELS.books}
        position={[-0.03, 0.41, 0]}
        scale={0.48}
        centerXZ
      />
      {[-0.22, 0.22]
        .flatMap(x => [-0.12, 0.12].map(z => ({ x, z })))
        .map(({ x, z }) => (
          <mesh key={`wheel-${x}-${z}`} position={[x, 0.02, z]}>
            <cylinderGeometry args={[0.038, 0.038, 0.032, 18]} />
            <meshStandardMaterial
              color={FUTURE_OFFICE_COLORS.screenSoft}
              roughness={0.46}
              metalness={0.18}
            />
          </mesh>
        ))}
    </group>
  );
}

function DecorativePlants() {
  return (
    <group>
      <FurnitureModel
        url={FURNITURE_MODELS.pottedPlant}
        position={[-6.2, 0, 3.6]}
        scale={1.15}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.pottedPlant}
        position={[6.25, 0, 3.4]}
        scale={1.15}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.plantSmall1}
        position={[-6.6, 0, -4.0]}
        scale={1.2}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.plantSmall1}
        position={[6.55, 0, -4.0]}
        scale={1.2}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.plantSmall2}
        position={[-7.0, 0, 4.45]}
        scale={1.1}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.plantSmall3}
        position={[7.0, 0, 4.45]}
        scale={1.1}
      />
    </group>
  );
}

export function OfficeRoom({
  showSecondaryDecor = true,
  reducedEffects = false,
  mode = "mission-first",
}: {
  showSecondaryDecor?: boolean;
  reducedEffects?: boolean;
  mode?: SceneFusionMode;
}) {
  const setSceneReady = useAppStore(state => state.setSceneReady);
  const setLoadingProgress = useAppStore(state => state.setLoadingProgress);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const locale = useAppStore(state => state.locale);
  // whybuddy-3d-real-role-driven-scene-2026-05-29: in blueprint mode the shared
  // office's decorative lamps + thin floor lines read as a stray "floating
  // lamp" / "black line" behind the real role scene, so they are suppressed.
  // Mission-first keeps the full decorated office.
  const showRoomDecorLamps = mode !== "blueprint";
  const showFloorLines = mode !== "blueprint";
  const organization = useMemo(
    () => selectWorkflowOrganization(currentWorkflow),
    [currentWorkflow]
  );
  const sceneDepartments = useMemo<SceneDepartmentInfo[]>(() => {
    if (organization) {
      return organization.departments.slice(0, 4).map((department, index) => {
        const manager =
          organization.nodes.find(
            node => node.id === department.managerNodeId
          ) || null;
        const slotName = getScenePodTitle(index, locale);
        return {
          id: department.id,
          title: slotName,
          subtitle: toShortLabel(
            department.label ||
              manager?.title ||
              manager?.name ||
              department.strategy,
            locale === "zh-CN" ? "动态编组" : "Dynamic Team"
          ),
          zoneLabel: slotName,
          color: SCENE_DEPARTMENT_COLORS[index] || FUTURE_OFFICE_COLORS.violet,
        };
      });
    }

    return [
      {
        id: "game",
        title: getScenePodTitle(0, locale),
        subtitle: getFallbackPodSubtitle(0, locale),
        zoneLabel: getScenePodTitle(0, locale),
        color: SCENE_DEPARTMENT_COLORS[0],
      },
      {
        id: "ai",
        title: getScenePodTitle(1, locale),
        subtitle: getFallbackPodSubtitle(1, locale),
        zoneLabel: getScenePodTitle(1, locale),
        color: SCENE_DEPARTMENT_COLORS[1],
      },
      {
        id: "life",
        title: getScenePodTitle(2, locale),
        subtitle: getFallbackPodSubtitle(2, locale),
        zoneLabel: getScenePodTitle(2, locale),
        color: SCENE_DEPARTMENT_COLORS[2],
      },
      {
        id: "meta",
        title: getScenePodTitle(3, locale),
        subtitle: getFallbackPodSubtitle(3, locale),
        zoneLabel: getScenePodTitle(3, locale),
        color: SCENE_DEPARTMENT_COLORS[3],
      },
    ];
  }, [locale, organization]);

  useEffect(() => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 12;
      setLoadingProgress(Math.min(progress, 100));
      if (progress >= 100) {
        clearInterval(interval);
        window.setTimeout(() => setSceneReady(true), 280);
      }
    }, 180);

    return () => clearInterval(interval);
  }, [setLoadingProgress, setSceneReady]);

  return (
    <group>
      <Floor showFloorLines={showFloorLines} />
      <Walls />
      {showSecondaryDecor ? (
        <ArchitecturalAccents showLamps={showRoomDecorLamps} />
      ) : null}
      <CorkBoard />
      {showSecondaryDecor ? (
        <DepartmentDecor departments={sceneDepartments} />
      ) : null}

      {sceneDepartments[0] ? (
        <ZoneBase
          position={SCENE_FLOW_ZONES.podA.floorPosition}
          color={sceneDepartments[0].color}
        />
      ) : null}
      {sceneDepartments[1] ? (
        <ZoneBase
          position={SCENE_FLOW_ZONES.podB.floorPosition}
          color={sceneDepartments[1].color}
        />
      ) : null}
      {sceneDepartments[2] ? (
        <ZoneBase
          position={SCENE_FLOW_ZONES.podC.floorPosition}
          color={sceneDepartments[2].color}
        />
      ) : null}
      {sceneDepartments[3] ? (
        <ZoneBase
          position={SCENE_FLOW_ZONES.podD.floorPosition}
          color={sceneDepartments[3].color}
        />
      ) : null}

      <DesktopDesk position={[0, 0, -3.55]} withLamp={showRoomDecorLamps} />
      {/* 自动驾驶 3D 场景融合 follow-up（2026-05-13）：CEO desk 由 z=-3.15
          后移到 z=-3.55，腾出 mission ring (z=-2.45) 与 desk front 之间的距离
          到 ~1.1m，避免 CEO（站在 mission ring 上）视觉穿桌。chair 在
          desk z 后再 +0.82 = -2.73，与 mission ring 间距 0.28m，仍是预期视觉
          （CEO 坐在桌前 ring 上，chair 在身后）。 */}
      <FurnitureModel
        url={FURNITURE_MODELS.rugRounded}
        position={[0, 0.01, -3.15]}
        scale={1.05}
      />

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[-3.5, 0.01, -1.95]}
        rotation={[0, Math.PI / 12, 0]}
        scale={1.26}
      />
      <DesktopDesk
        position={[-4.35, 0, -2.95]}
        rotation={[0, Math.PI / 18, 0]}
        compact
      />
      <LaptopDesk
        position={[-2.45, 0, -1.15]}
        rotation={[0, -Math.PI / 7, 0]}
        showLamp={showRoomDecorLamps}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.chairRounded}
        position={[-3.1, 0, -2.22]}
        rotation={[0, Math.PI / 2.8, 0]}
      />
      {showSecondaryDecor ? (
        <>
          <StorageColumn
            position={[-2.1, 0, -2.92]}
            rotation={[0, -Math.PI / 5, 0]}
            low
          />
          <MobileBoard
            position={[-5.92, 0, -1.15]}
            rotation={[0, Math.PI / 2, 0]}
            color={sceneDepartments[0]?.color || SCENE_DEPARTMENT_COLORS[0]}
            title={sceneDepartments[0]?.title || getScenePodTitle(0, locale)}
            subtitle={
              sceneDepartments[0]?.subtitle || getFallbackPodSubtitle(0, locale)
            }
          />
          <TaskCart
            position={[-5.25, 0, -2.72]}
            rotation={[0, Math.PI / 8, 0]}
            color={sceneDepartments[0]?.color || SCENE_DEPARTMENT_COLORS[0]}
          />
        </>
      ) : null}

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[3.55, 0.01, -1.92]}
        rotation={[0, -Math.PI / 10, 0]}
        scale={1.22}
      />
      <LaptopDesk position={[2.35, 0, -1.08]} rotation={[0, Math.PI / 6, 0]} showLamp={showRoomDecorLamps} />
      <MeetingSet position={[4.85, 0, -1.42]} rotation={[0, -Math.PI / 8, 0]} />
      {showSecondaryDecor ? (
        <>
          <FurnitureModel
            url={FURNITURE_MODELS.sideTable}
            position={[3.55, 0, -2.88]}
            rotation={[0, -Math.PI / 6, 0]}
            scale={0.92}
            centerXZ
          />
          <FurnitureModel
            url={FURNITURE_MODELS.laptop}
            position={[3.55, 0.39, -2.88]}
            rotation={[0, -Math.PI / 6, 0]}
            scale={0.92}
            centerXZ
          />
          <MobileBoard
            position={[5.95, 0, -2.45]}
            rotation={[0, -Math.PI / 2.3, 0]}
            color={sceneDepartments[1]?.color || SCENE_DEPARTMENT_COLORS[1]}
            title={sceneDepartments[1]?.title || getScenePodTitle(1, locale)}
            subtitle={
              sceneDepartments[1]?.subtitle || getFallbackPodSubtitle(1, locale)
            }
          />
          <TaskCart
            position={[2.05, 0, -2.52]}
            rotation={[0, -Math.PI / 10, 0]}
            color={sceneDepartments[1]?.color || SCENE_DEPARTMENT_COLORS[1]}
          />
        </>
      ) : null}

      <FurnitureModel
        url={FURNITURE_MODELS.rugRectangle}
        position={[-3.35, 0.01, 2.45]}
        rotation={[0, -Math.PI / 14, 0]}
        scale={1.3}
      />
      <MeetingSet position={[-3.55, 0, 2.28]} rotation={[0, Math.PI / 10, 0]} />
      <LaptopDesk position={[-5.3, 0, 2.9]} rotation={[0, Math.PI / 2.4, 0]} showLamp={showRoomDecorLamps} />
      {showSecondaryDecor ? (
        <>
          <FurnitureModel
            url={FURNITURE_MODELS.chairRounded}
            position={[-2.1, 0, 2.98]}
            rotation={[0, -Math.PI / 2.6, 0]}
          />
          <StorageColumn
            position={[-5.95, 0, 3.5]}
            rotation={[0, Math.PI / 2, 0]}
            low
          />
          <MobileBoard
            position={[-5.98, 0, 1.48]}
            rotation={[0, Math.PI / 2, 0]}
            color={sceneDepartments[2]?.color || SCENE_DEPARTMENT_COLORS[2]}
            title={sceneDepartments[2]?.title || getScenePodTitle(2, locale)}
            subtitle={
              sceneDepartments[2]?.subtitle || getFallbackPodSubtitle(2, locale)
            }
          />
          <TaskCart
            position={[-1.98, 0, 2.62]}
            rotation={[0, Math.PI / 7, 0]}
            color={sceneDepartments[2]?.color || SCENE_DEPARTMENT_COLORS[2]}
          />
        </>
      ) : null}

      <FurnitureModel
        url={FURNITURE_MODELS.rugRounded}
        position={[3.18, 0.01, 2.42]}
        rotation={[0, Math.PI / 11, 0]}
        scale={1.24}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.tableCoffeeSquare}
        position={[3.05, 0, 2.42]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.loungeChair}
        position={[2.02, 0, 2.08]}
        rotation={[0, Math.PI / 3.4, 0]}
      />
      <FurnitureModel
        url={FURNITURE_MODELS.loungeChair}
        position={[4.18, 0, 2.12]}
        rotation={[0, -Math.PI / 2.8, 0]}
      />
      {showSecondaryDecor ? (
        <>
          <LaptopDesk
            position={[5.25, 0, 2.26]}
            rotation={[0, -Math.PI / 2.2, 0]}
            showLamp={showRoomDecorLamps}
          />
          <StorageColumn
            position={[5.92, 0, 3.42]}
            rotation={[0, -Math.PI / 2.2, 0]}
            low
          />
          <MobileBoard
            position={[5.95, 0, 1.58]}
            rotation={[0, -Math.PI / 2, 0]}
            color={sceneDepartments[3]?.color || SCENE_DEPARTMENT_COLORS[3]}
            title={sceneDepartments[3]?.title || getScenePodTitle(3, locale)}
            subtitle={
              sceneDepartments[3]?.subtitle || getFallbackPodSubtitle(3, locale)
            }
          />
          <TaskCart
            position={[1.96, 0, 2.88]}
            rotation={[0, -Math.PI / 8, 0]}
            color={sceneDepartments[3]?.color || SCENE_DEPARTMENT_COLORS[3]}
          />

          <LoungeArea position={[0.2, 0, 4.1]} showLamp={showRoomDecorLamps} />
          <FurnitureModel
            url={FURNITURE_MODELS.tableCoffee}
            position={[-0.3, 0, 1.15]}
          />
          <FurnitureModel
            url={FURNITURE_MODELS.loungeChair}
            position={[-1.95, 0, 1.4]}
            rotation={[0, Math.PI / 3, 0]}
          />
          <FurnitureModel
            url={FURNITURE_MODELS.loungeChair}
            position={[1.6, 0, 1.35]}
            rotation={[0, -Math.PI / 3, 0]}
          />

          <DecorativePlants />
        </>
      ) : null}
    </group>
  );
}
