// Copyright WhyBuddy. All Rights Reserved.
//
// Lounge & Decor Data — UE5-compatible constants for the lounge/rest area,
// decorative plants, and architectural accent elements.
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
namespace LoungeDecor
{

// ============================================================================
// LoungeArea Group — Front-Center Rest Area
// ============================================================================
// Three.js: LoungeArea group at (0.2, 0, 4.1)
// All child positions are local offsets relative to the group origin.

namespace LoungeArea
{
    /** Group world position: Three.js (0.2, 0, 4.1) */
    constexpr FVector GroupPosition = FVector(20.0f, -410.0f, 0.0f);

    // --- Long Sofa ---
    // Three.js local: (0, 0, 0), rotation Y = PI
    constexpr FVector SofaLocalOffset = FVector(0.0f, 0.0f, 0.0f);
    constexpr float   SofaYaw         = -180.0f;
    // Model: SM_Lounge_Sofa_Long_01

    // --- Lounge Chair (right of sofa) ---
    // Three.js local: (1.6, 0, 0.15), rotation Y = -PI/2
    constexpr FVector ChairLocalOffset = FVector(160.0f, -15.0f, 0.0f);
    constexpr float   ChairYaw         = 90.0f;
    // Model: SM_Lounge_Chair_01

    // --- Square Coffee Table ---
    // Three.js local: (0.8, 0, 1.2), no rotation
    constexpr FVector CoffeeTableLocalOffset = FVector(80.0f, -120.0f, 0.0f);
    constexpr float   CoffeeTableYaw         = 0.0f;
    // Model: SM_Table_Coffee_Square_01

    // --- Side Table (left of sofa) ---
    // Three.js local: (-1.45, 0, 0.3), no rotation
    constexpr FVector SideTableLocalOffset = FVector(-145.0f, -30.0f, 0.0f);
    constexpr float   SideTableYaw         = 0.0f;
    // Model: SM_Side_Table_01

    // --- Round Table Lamp (on side table) ---
    // Three.js local: (-1.45, 0.7, 0.3), no rotation
    constexpr FVector LampLocalOffset = FVector(-145.0f, -30.0f, 70.0f);
    constexpr float   LampYaw         = 0.0f;
    // Model: SM_Lamp_RoundTable_01

    constexpr int32 FurnitureCount = 5;
}

// ============================================================================
// Additional Center Lounge Furniture (world coordinates)
// ============================================================================
// These items are NOT children of the LoungeArea group.

namespace CenterLounge
{
    // --- Round Coffee Table ---
    // Three.js: (-0.3, 0, 1.15), no rotation
    constexpr FVector CoffeeTablePosition = FVector(-30.0f, -115.0f, 0.0f);
    constexpr float   CoffeeTableYaw      = 0.0f;
    // Model: SM_Table_Coffee_01

    // --- Lounge Chair A (left, facing table) ---
    // Three.js: (-1.95, 0, 1.4), rotation Y = PI/3
    constexpr FVector ChairAPosition = FVector(-195.0f, -140.0f, 0.0f);
    constexpr float   ChairAYaw      = -60.0f;
    // Model: SM_Lounge_Chair_01

    // --- Lounge Chair B (right, facing table) ---
    // Three.js: (1.6, 0, 1.35), rotation Y = -PI/3
    constexpr FVector ChairBPosition = FVector(160.0f, -135.0f, 0.0f);
    constexpr float   ChairBYaw      = 60.0f;
    // Model: SM_Lounge_Chair_01

    constexpr int32 FurnitureCount = 3;
}

// ============================================================================
// Decorative Plants
// ============================================================================

namespace Plants
{
    // --- Large Potted Plants (pottedPlant) ---

    struct FPlantPlacement
    {
        FVector Position;
        float Scale;
    };

    // Three.js: (-6.2, 0, 3.6), scale 1.15
    // Three.js: (6.25, 0, 3.4), scale 1.15
    constexpr FPlantPlacement PottedPlants[] = {
        { FVector(-620.0f, -360.0f, 0.0f), 1.15f },  // Left-front
        { FVector( 625.0f, -340.0f, 0.0f), 1.15f },  // Right-front
    };
    constexpr int32 PottedPlantCount = UE_ARRAY_COUNT(PottedPlants);
    // Model: SM_Potted_Plant_01

    // --- Small Plants Type A (plantSmall1) ---
    // Three.js: (-6.6, 0, -4.0), scale 1.2
    // Three.js: (6.55, 0, -4.0), scale 1.2
    constexpr FPlantPlacement SmallPlantsA[] = {
        { FVector(-660.0f, 400.0f, 0.0f), 1.2f },  // Left-back
        { FVector( 655.0f, 400.0f, 0.0f), 1.2f },  // Right-back
    };
    constexpr int32 SmallPlantACount = UE_ARRAY_COUNT(SmallPlantsA);
    // Model: SM_Plant_Small_01

    // --- Small Plant Type B (plantSmall2) ---
    // Three.js: (-7.0, 0, 4.45), scale 1.1
    constexpr FPlantPlacement SmallPlantB = {
        FVector(-700.0f, -445.0f, 0.0f), 1.1f   // Left-front corner
    };
    // Model: SM_Plant_Small_02

    // --- Small Plant Type C (plantSmall3) ---
    // Three.js: (7.0, 0, 4.45), scale 1.1
    constexpr FPlantPlacement SmallPlantC = {
        FVector(700.0f, -445.0f, 0.0f), 1.1f    // Right-front corner
    };
    // Model: SM_Plant_Small_03

    constexpr int32 TotalPlantCount = PottedPlantCount + SmallPlantACount + 2;
    // = 2 + 2 + 2 = 6
}

// ============================================================================
// Architectural Accents
// ============================================================================

// --- Coat Rack ---
// Three.js: (6.55, 0, -1.35), rotation Y = -PI/3
namespace CoatRack
{
    constexpr FVector Position = FVector(655.0f, 135.0f, 0.0f);
    constexpr float   Yaw     = 60.0f;
    // Model: SM_Coat_Rack_Standing_01
}

// --- Floor Lamp ---
// Three.js: (-6.3, 0, 0.6), rotation Y = PI/6
namespace FloorLamp
{
    constexpr FVector Position = FVector(-630.0f, -60.0f, 0.0f);
    constexpr float   Yaw     = -30.0f;
    // Model: SM_Lamp_Round_Floor_01

    // Associated Point Light
    // Three.js: (-6.15, 1.85, 0.65), intensity 0.42, color #FFE2B8, distance 4.6m
    constexpr FVector LightPosition    = FVector(-615.0f, -65.0f, 185.0f);
    constexpr float   LightIntensity   = 0.42f;   // Three.js scale; convert to UE5 lumens in-editor
    constexpr FLinearColor LightColor  = FLinearColor(1.0f, 0.886f, 0.722f, 1.0f);  // #FFE2B8
    constexpr float   LightRadius      = 460.0f;  // cm (4.6m attenuation distance)
}

// --- Wall Lamp ---
// Three.js: (0, 1.08, -4.72), scale 1.05
namespace WallLamp
{
    constexpr FVector Position = FVector(0.0f, 472.0f, 108.0f);
    constexpr float   Scale    = 1.05f;
    // Model: SM_Lamp_Wall_01

    // Associated Point Light
    // Three.js: (0, 1.22, -4.4), intensity 0.18, color #FFDDB0, distance 3.0m
    constexpr FVector LightPosition    = FVector(0.0f, 440.0f, 122.0f);
    constexpr float   LightIntensity   = 0.18f;   // Three.js scale; convert to UE5 lumens in-editor
    constexpr FLinearColor LightColor  = FLinearColor(1.0f, 0.867f, 0.690f, 1.0f);  // #FFDDB0
    constexpr float   LightRadius      = 300.0f;  // cm (3.0m attenuation distance)
}

// ============================================================================
// Summary: Total Lounge & Decor Placements
// ============================================================================

/** Total number of lounge/decor element placements. */
constexpr int32 TotalLoungeDecorPlacements =
    LoungeArea::FurnitureCount       // 5 (sofa, chair, coffee table, side table, lamp)
    + CenterLounge::FurnitureCount   // 3 (coffee table, 2 chairs)
    + Plants::TotalPlantCount        // 6 (2 potted + 2 small A + 1 small B + 1 small C)
    + 1                              // Coat rack
    + 1                              // Floor lamp (+ point light)
    + 1;                             // Wall lamp (+ point light)
// = 5 + 3 + 6 + 1 + 1 + 1 = 17

// ============================================================================
// Coordinate Conversion Helpers (same as RoomShellData.h / WorkAreaData.h)
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

} // namespace LoungeDecor
} // namespace CubePets
