// Copyright WhyBuddy. All Rights Reserved.
//
// Work Area Data — UE5-compatible constants for the 4 pod work areas + CEO desk.
// All values are in centimeters (cm) using UE5 Z-up coordinate system.
//
// Conversion from Three.js (Y-up, meters):
//   UE5_X =  ThreeJS_X * 100
//   UE5_Y =  ThreeJS_Z * -100
//   UE5_Z =  ThreeJS_Y * 100
//   UE5_Yaw = -ThreeJS_RotY * (180 / PI)
//
// Source: client/src/components/three/OfficeRoom.tsx

#pragma once

#include "CoreMinimal.h"

namespace CubePets
{
namespace WorkArea
{

// ============================================================================
// Common Furniture Placement Struct
// ============================================================================

struct FFurniturePlacement
{
    FVector Position;
    float Yaw;       // degrees
    float Scale;     // uniform scale, 1.0 = default
};

// ============================================================================
// DesktopDesk Sub-Component Offsets (local space, cm)
// ============================================================================
// Each DesktopDesk is a composite: desk + chair + screen + keyboard + mouse [+ lamp]

namespace DesktopDeskOffsets
{
    // Standard variant
    constexpr FVector ChairOffset          = FVector(0.0f, -82.0f, 0.0f);
    constexpr float   ChairYaw             = 180.0f;
    constexpr FVector ScreenOffset         = FVector(0.0f, 2.0f, 39.2f);
    constexpr FVector KeyboardOffset       = FVector(0.0f, -20.0f, 39.2f);
    constexpr FVector MouseOffset          = FVector(22.0f, -20.0f, 39.2f);

    // Compact variant (slightly tighter spacing)
    constexpr FVector ChairOffsetCompact   = FVector(0.0f, -72.0f, 0.0f);
    constexpr FVector ScreenOffsetCompact  = FVector(0.0f, -2.0f, 39.2f);
    constexpr FVector KeyboardOffsetCompact= FVector(0.0f, -24.0f, 39.2f);
    constexpr FVector MouseOffsetCompact   = FVector(22.0f, -24.0f, 39.2f);

    // Optional lamp (withLamp = true)
    constexpr FVector LampOffset           = FVector(-24.0f, -4.0f, 39.2f);
}

// ============================================================================
// LaptopDesk Sub-Component Offsets (local space, cm)
// ============================================================================

namespace LaptopDeskOffsets
{
    constexpr FVector ChairOffset   = FVector(0.0f, -82.0f, 0.0f);
    constexpr float   ChairYaw     = 180.0f;
    constexpr FVector LaptopOffset  = FVector(0.0f, -8.0f, 39.2f);
    constexpr FVector LampOffset    = FVector(24.0f, -4.0f, 39.2f);
}

// ============================================================================
// MeetingSet Sub-Component Offsets (local space, cm)
// ============================================================================

namespace MeetingSetOffsets
{
    // Round table at origin
    constexpr FVector ChairRight  = FVector(95.0f, 0.0f, 0.0f);
    constexpr float   ChairRightYaw = 90.0f;   // faces inward
    constexpr FVector ChairLeft   = FVector(-95.0f, 0.0f, 0.0f);
    constexpr float   ChairLeftYaw  = -90.0f;  // faces inward
    constexpr FVector ChairFront  = FVector(0.0f, -95.0f, 0.0f);
    constexpr float   ChairFrontYaw = 180.0f;  // faces inward
}

// ============================================================================
// StorageColumn (Low) Sub-Component Offsets (local space, cm)
// ============================================================================

namespace StorageColumnOffsets
{
    // Low bookcase + books on top
    constexpr FVector BooksOffset = FVector(0.0f, 0.0f, 50.0f);
}

// ============================================================================
// CEO Desk — Center-Back
// ============================================================================
// Three.js: DesktopDesk at (0, 0, -3.15), withLamp=true

namespace CEO
{
    constexpr FVector DeskPosition = FVector(0.0f, 315.0f, 0.0f);
    constexpr float   DeskYaw     = 0.0f;
    constexpr bool    DeskCompact = false;
    constexpr bool    DeskWithLamp = true;

    // Rug: Three.js (0, 0.01, -3.15), scale 1.05
    constexpr FVector RugPosition = FVector(0.0f, 315.0f, 1.0f);
    constexpr float   RugScale    = 1.05f;
    // Model: SM_Rug_Rounded_01
}

// ============================================================================
// Pod A — Left-Back Work Area
// ============================================================================
// Three.js zone: left-back quadrant

namespace PodA
{
    // DesktopDesk (compact): Three.js (-4.35, 0, -2.95), rot Y = PI/18
    constexpr FVector DesktopDeskPosition = FVector(-435.0f, 295.0f, 0.0f);
    constexpr float   DesktopDeskYaw      = -10.0f;
    constexpr bool    DesktopDeskCompact  = true;

    // LaptopDesk: Three.js (-2.45, 0, -1.15), rot Y = -PI/7
    constexpr FVector LaptopDeskPosition = FVector(-245.0f, 115.0f, 0.0f);
    constexpr float   LaptopDeskYaw      = 25.7f;

    // ChairRounded (standalone): Three.js (-3.1, 0, -2.22), rot Y = PI/2.8
    constexpr FVector ChairRoundedPosition = FVector(-310.0f, 222.0f, 0.0f);
    constexpr float   ChairRoundedYaw      = -64.3f;

    // StorageColumn (low): Three.js (-2.1, 0, -2.92), rot Y = -PI/5
    constexpr FVector StoragePosition = FVector(-210.0f, 292.0f, 0.0f);
    constexpr float   StorageYaw      = 36.0f;

    // Rug (rectangle): Three.js (-3.5, 0.01, -1.95), rot Y = PI/12, scale 1.26
    constexpr FVector RugPosition = FVector(-350.0f, 195.0f, 1.0f);
    constexpr float   RugYaw      = -15.0f;
    constexpr float   RugScale    = 1.26f;

    // All placements as array for iteration
    constexpr int32 FurnitureCount = 5;
}

// ============================================================================
// Pod B — Right-Back Work Area
// ============================================================================

namespace PodB
{
    // LaptopDesk: Three.js (2.35, 0, -1.08), rot Y = PI/6
    constexpr FVector LaptopDeskPosition = FVector(235.0f, 108.0f, 0.0f);
    constexpr float   LaptopDeskYaw      = -30.0f;

    // MeetingSet: Three.js (4.85, 0, -1.42), rot Y = -PI/8
    constexpr FVector MeetingSetPosition = FVector(485.0f, 142.0f, 0.0f);
    constexpr float   MeetingSetYaw      = 22.5f;

    // SideTable: Three.js (3.55, 0, -2.88), rot Y = -PI/6, scale 0.92
    constexpr FVector SideTablePosition = FVector(355.0f, 288.0f, 0.0f);
    constexpr float   SideTableYaw      = 30.0f;
    constexpr float   SideTableScale    = 0.92f;

    // Laptop on SideTable: Three.js (3.55, 0.39, -2.88), rot Y = -PI/6, scale 0.92
    constexpr FVector SideTableLaptopPosition = FVector(355.0f, 288.0f, 39.0f);
    constexpr float   SideTableLaptopYaw      = 30.0f;
    constexpr float   SideTableLaptopScale    = 0.92f;

    // Rug (rectangle): Three.js (3.55, 0.01, -1.92), rot Y = -PI/10, scale 1.22
    constexpr FVector RugPosition = FVector(355.0f, 192.0f, 1.0f);
    constexpr float   RugYaw      = 18.0f;
    constexpr float   RugScale    = 1.22f;

    constexpr int32 FurnitureCount = 5;
}

// ============================================================================
// Pod C — Left-Front Work Area
// ============================================================================

namespace PodC
{
    // MeetingSet: Three.js (-3.55, 0, 2.28), rot Y = PI/10
    constexpr FVector MeetingSetPosition = FVector(-355.0f, -228.0f, 0.0f);
    constexpr float   MeetingSetYaw      = -18.0f;

    // LaptopDesk: Three.js (-5.3, 0, 2.9), rot Y = PI/2.4
    constexpr FVector LaptopDeskPosition = FVector(-530.0f, -290.0f, 0.0f);
    constexpr float   LaptopDeskYaw      = -75.0f;

    // ChairRounded (standalone): Three.js (-2.1, 0, 2.98), rot Y = -PI/2.6
    constexpr FVector ChairRoundedPosition = FVector(-210.0f, -298.0f, 0.0f);
    constexpr float   ChairRoundedYaw      = 69.2f;

    // StorageColumn (low): Three.js (-5.95, 0, 3.5), rot Y = PI/2
    constexpr FVector StoragePosition = FVector(-595.0f, -350.0f, 0.0f);
    constexpr float   StorageYaw      = -90.0f;

    // Rug (rectangle): Three.js (-3.35, 0.01, 2.45), rot Y = -PI/14, scale 1.3
    constexpr FVector RugPosition = FVector(-335.0f, -245.0f, 1.0f);
    constexpr float   RugYaw      = 12.9f;
    constexpr float   RugScale    = 1.3f;

    constexpr int32 FurnitureCount = 5;
}

// ============================================================================
// Pod D — Right-Front Work Area (Lounge Style)
// ============================================================================

namespace PodD
{
    // CoffeeSquareTable: Three.js (3.05, 0, 2.42), no rotation
    constexpr FVector CoffeeTablePosition = FVector(305.0f, -242.0f, 0.0f);
    constexpr float   CoffeeTableYaw      = 0.0f;

    // LoungeChair Left: Three.js (2.02, 0, 2.08), rot Y = PI/3.4
    constexpr FVector LoungeChairLeftPosition = FVector(202.0f, -208.0f, 0.0f);
    constexpr float   LoungeChairLeftYaw      = -52.9f;

    // LoungeChair Right: Three.js (4.18, 0, 2.12), rot Y = -PI/2.8
    constexpr FVector LoungeChairRightPosition = FVector(418.0f, -212.0f, 0.0f);
    constexpr float   LoungeChairRightYaw      = 64.3f;

    // LaptopDesk: Three.js (5.25, 0, 2.26), rot Y = -PI/2.2
    constexpr FVector LaptopDeskPosition = FVector(525.0f, -226.0f, 0.0f);
    constexpr float   LaptopDeskYaw      = 81.8f;

    // StorageColumn (low): Three.js (5.92, 0, 3.42), rot Y = -PI/2.2
    constexpr FVector StoragePosition = FVector(592.0f, -342.0f, 0.0f);
    constexpr float   StorageYaw      = 81.8f;

    // Rug (rounded): Three.js (3.18, 0.01, 2.42), rot Y = PI/11, scale 1.24
    constexpr FVector RugPosition = FVector(318.0f, -242.0f, 1.0f);
    constexpr float   RugYaw      = -16.4f;
    constexpr float   RugScale    = 1.24f;

    constexpr int32 FurnitureCount = 6;
}

// ============================================================================
// Summary: All Pod Positions (for iteration / validation)
// ============================================================================

/** Total number of top-level furniture placements across all pods + CEO desk. */
constexpr int32 TotalWorkAreaPlacements =
    1  // CEO desk
    + PodA::FurnitureCount
    + PodB::FurnitureCount
    + PodC::FurnitureCount
    + PodD::FurnitureCount;
// = 1 + 5 + 5 + 5 + 6 = 22

// ============================================================================
// Coordinate Conversion Helpers (same as RoomShellData.h)
// ============================================================================

/** Convert a Three.js position (Y-up, meters) to UE5 position (Z-up, cm). */
FORCEINLINE FVector ThreeJsToUE5(float X, float Y, float Z)
{
    return FVector(X * 100.0f, Z * -100.0f, Y * 100.0f);
}

/** Convert a Three.js Y-axis rotation (radians) to UE5 Yaw (degrees). */
FORCEINLINE float ThreeJsRotYToUE5Yaw(float RadiansY)
{
    return FMath::RadiansToDegrees(-RadiansY);
}

} // namespace WorkArea
} // namespace CubePets
