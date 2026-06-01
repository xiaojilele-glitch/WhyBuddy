// Copyright WhyBuddy. All Rights Reserved.
//
// Meeting & Collaboration Data — UE5-compatible constants for meeting/collaboration elements.
// Covers: CorkBoard, MobileBoards (4), TaskCarts (4).
// MeetingSet positions are defined in WorkAreaData.h (PodB, PodC).
//
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
namespace MeetingCollab
{

// ============================================================================
// CorkBoard — Center Back Wall
// ============================================================================
// Three.js: position (0, 2.02, -4.72), no rotation

namespace CorkBoard
{
    constexpr FVector Position = FVector(0.0f, 472.0f, 202.0f);
    constexpr float   Yaw     = 0.0f;

    // Main board surface: 2.7m x 1.16m x 0.06m
    constexpr float BoardWidth     = 270.0f;   // cm
    constexpr float BoardDepth     = 6.0f;     // cm
    constexpr float BoardHeight    = 116.0f;   // cm

    // Outer frame: 2.86m x 1.29m x 0.03m
    constexpr float FrameWidth     = 286.0f;   // cm
    constexpr float FrameDepth     = 3.0f;     // cm
    constexpr float FrameHeight    = 129.0f;   // cm

    // Colors (linear sRGB hex references)
    // Board color: #C4956A (cork)
    // Frame color: #8B6914 (dark gold wood)

    constexpr int32 StickyNoteCount = 2;
}

// ============================================================================
// MobileBoard — One per Pod (4 total)
// ============================================================================
// Each MobileBoard has: whiteboard surface (118 x 88 cm), color strip,
// support legs, sticky notes, and label.

namespace MobileBoard
{
    // Whiteboard surface dimensions
    constexpr float WhiteboardWidth  = 118.0f;  // cm (1.18m)
    constexpr float WhiteboardHeight = 88.0f;   // cm (0.88m)

    constexpr int32 TotalCount = 4;

    // --- Pod A: Three.js (-5.92, 0, -1.15), rot Y = PI/2 ---
    namespace PodA
    {
        constexpr FVector Position = FVector(-592.0f, 115.0f, 0.0f);
        constexpr float   Yaw     = -90.0f;
    }

    // --- Pod B: Three.js (5.95, 0, -2.45), rot Y = -PI/2.3 ---
    namespace PodB
    {
        constexpr FVector Position = FVector(595.0f, 245.0f, 0.0f);
        constexpr float   Yaw     = 78.3f;
    }

    // --- Pod C: Three.js (-5.98, 0, 1.48), rot Y = PI/2 ---
    namespace PodC
    {
        constexpr FVector Position = FVector(-598.0f, -148.0f, 0.0f);
        constexpr float   Yaw     = -90.0f;
    }

    // --- Pod D: Three.js (5.95, 0, 1.58), rot Y = -PI/2 ---
    namespace PodD
    {
        constexpr FVector Position = FVector(595.0f, -158.0f, 0.0f);
        constexpr float   Yaw     = 90.0f;
    }
}

// ============================================================================
// TaskCart — One per Pod (4 total)
// ============================================================================
// Each TaskCart is a small rolling cart with shelves for files and supplies.

namespace TaskCart
{
    constexpr int32 TotalCount = 4;

    // --- Pod A: Three.js (-5.25, 0, -2.72), rot Y = PI/8 ---
    namespace PodA
    {
        constexpr FVector Position = FVector(-525.0f, 272.0f, 0.0f);
        constexpr float   Yaw     = -22.5f;
    }

    // --- Pod B: Three.js (2.05, 0, -2.52), rot Y = -PI/10 ---
    namespace PodB
    {
        constexpr FVector Position = FVector(205.0f, 252.0f, 0.0f);
        constexpr float   Yaw     = 18.0f;
    }

    // --- Pod C: Three.js (-1.98, 0, 2.62), rot Y = PI/7 ---
    namespace PodC
    {
        constexpr FVector Position = FVector(-198.0f, -262.0f, 0.0f);
        constexpr float   Yaw     = -25.7f;
    }

    // --- Pod D: Three.js (1.96, 0, 2.88), rot Y = -PI/8 ---
    namespace PodD
    {
        constexpr FVector Position = FVector(196.0f, -288.0f, 0.0f);
        constexpr float   Yaw     = 22.5f;
    }
}

// ============================================================================
// Summary: Total Meeting/Collaboration Placements
// ============================================================================

/** Total number of meeting/collaboration element placements. */
constexpr int32 TotalMeetingCollabPlacements =
    1                          // CorkBoard
    + MobileBoard::TotalCount  // 4 MobileBoards
    + TaskCart::TotalCount;    // 4 TaskCarts
// = 1 + 4 + 4 = 9
// Note: MeetingSet placements (Pod B, Pod C) are counted in WorkAreaData.h

// ============================================================================
// Coordinate Conversion Helpers (same as WorkAreaData.h / RoomShellData.h)
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

} // namespace MeetingCollab
} // namespace CubePets
