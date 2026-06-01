// Copyright WhyBuddy. All Rights Reserved.
//
// Room Shell Data — UE5-compatible constants for the office room shell.
// All values are in centimeters (cm) using UE5 Z-up coordinate system.
//
// Conversion from Three.js (Y-up, meters):
//   UE5_X =  ThreeJS_X * 100
//   UE5_Y =  ThreeJS_Z * -100
//   UE5_Z =  ThreeJS_Y * 100
//
// Source: client/src/components/three/OfficeRoom.tsx

#pragma once

#include "CoreMinimal.h"

namespace CubePets
{
namespace RoomShell
{

// ============================================================================
// Room Overall Dimensions
// ============================================================================

/** Wall height: 3.0m -> 300cm */
constexpr float WallHeight = 300.0f;

/** Wall thickness: 0.18m -> 18cm */
constexpr float WallThickness = 18.0f;

// ============================================================================
// Floor Planes
// ============================================================================

/** Main floor plane: 18m x 14m */
constexpr float FloorMainWidth  = 1800.0f;
constexpr float FloorMainDepth  = 1400.0f;
constexpr FVector FloorMainPosition = FVector(0.0f, 0.0f, 0.0f);

/** Middle decorative floor: 14.8m x 10.6m */
constexpr float FloorMiddleWidth = 1480.0f;
constexpr float FloorMiddleDepth = 1060.0f;
constexpr FVector FloorMiddlePosition = FVector(0.0f, 0.0f, 0.2f);

/** Inner decorative floor: 11.8m x 7.8m */
constexpr float FloorInnerWidth = 1180.0f;
constexpr float FloorInnerDepth = 780.0f;
constexpr FVector FloorInnerPosition = FVector(0.0f, 0.0f, 0.4f);

// ============================================================================
// Walls
// ============================================================================

// --- Back Wall ---
// Three.js: position (0, 1.5, -4.9), size 15.42 x 3.0 x 0.18
constexpr float BackWallWidth = 1542.0f;
constexpr FVector BackWallPosition = FVector(0.0f, 490.0f, 150.0f);
constexpr FVector BackWallExtent = FVector(1542.0f, 18.0f, 300.0f);

// --- Left Wall ---
// Three.js: position (-7.8, 1.5, 0), size 9.98 x 3.0 x 0.18, rotated 90 deg
constexpr float LeftWallLength = 998.0f;
constexpr FVector LeftWallPosition = FVector(-780.0f, 0.0f, 150.0f);
constexpr FVector LeftWallExtent = FVector(18.0f, 998.0f, 300.0f);

// --- Right Wall ---
// Three.js: position (7.8, 1.5, 0), size 9.98 x 3.0 x 0.18, rotated 90 deg
constexpr float RightWallLength = 998.0f;
constexpr FVector RightWallPosition = FVector(780.0f, 0.0f, 150.0f);
constexpr FVector RightWallExtent = FVector(18.0f, 998.0f, 300.0f);

// ============================================================================
// Baseboards (Skirting Boards)
// ============================================================================

constexpr float BaseboardHeight = 56.0f;    // 0.56m
constexpr float BaseboardThickness = 5.0f;  // 0.05m

// --- Back Wall Baseboard ---
// Three.js: position (0, 0.42, -4.79), size 15.2 x 0.56 x 0.05
constexpr float BackBaseboardWidth = 1520.0f;
constexpr FVector BackBaseboardPosition = FVector(0.0f, 479.0f, 42.0f);
constexpr FVector BackBaseboardExtent = FVector(1520.0f, 5.0f, 56.0f);

// --- Left Wall Baseboard ---
// Three.js: position (-7.7, 0.42, 0), size 9.6 x 0.56 x 0.05, rotated 90 deg
constexpr float LeftBaseboardLength = 960.0f;
constexpr FVector LeftBaseboardPosition = FVector(-770.0f, 0.0f, 42.0f);
constexpr FVector LeftBaseboardExtent = FVector(5.0f, 960.0f, 56.0f);

// --- Right Wall Baseboard ---
// Three.js: position (7.7, 0.42, 0), size 9.6 x 0.56 x 0.05, rotated 90 deg
constexpr float RightBaseboardLength = 960.0f;
constexpr FVector RightBaseboardPosition = FVector(770.0f, 0.0f, 42.0f);
constexpr FVector RightBaseboardExtent = FVector(5.0f, 960.0f, 56.0f);

// ============================================================================
// Wall Root Shadow Strips
// ============================================================================

// --- Back Wall Shadow ---
// Three.js: position (0, 0.006, -4.42), size 15.1 x 0.85
constexpr FVector BackShadowPosition = FVector(0.0f, 442.0f, 0.6f);
constexpr FVector2D BackShadowSize = FVector2D(1510.0f, 85.0f);
constexpr float BackShadowOpacity = 0.14f;

// --- Left Wall Shadow ---
// Three.js: position (-7.38, 0.006, 0), size 9.6 x 0.78
constexpr FVector LeftShadowPosition = FVector(-738.0f, 0.0f, 0.6f);
constexpr FVector2D LeftShadowSize = FVector2D(78.0f, 960.0f);
constexpr float LeftShadowOpacity = 0.10f;

// --- Right Wall Shadow ---
// Three.js: position (7.38, 0.006, 0), size 9.6 x 0.78
constexpr FVector RightShadowPosition = FVector(738.0f, 0.0f, 0.6f);
constexpr FVector2D RightShadowSize = FVector2D(78.0f, 960.0f);
constexpr float RightShadowOpacity = 0.08f;

// ============================================================================
// Wall Corners
// ============================================================================

// --- Left-Back Corner (wallCorner, straight) ---
// Three.js: position (-7.72, 0, -4.82), rotation Y = PI/2, scale 1.08
constexpr FVector LeftBackCornerPosition = FVector(-772.0f, 482.0f, 0.0f);
constexpr float LeftBackCornerYaw = 90.0f;  // degrees
constexpr float LeftBackCornerScale = 1.08f;

// --- Right-Back Corner (wallCornerRond, rounded) ---
// Three.js: position (7.72, 0, -4.82), rotation Y = PI, scale 1.08
constexpr FVector RightBackCornerPosition = FVector(772.0f, 482.0f, 0.0f);
constexpr float RightBackCornerYaw = 180.0f;  // degrees
constexpr float RightBackCornerScale = 1.08f;

// ============================================================================
// Doorway
// ============================================================================

// --- Wide Doorway on Right Wall ---
// Three.js: position (7.65, 0, -2.9), rotation Y = -PI/2, scale 1.06
constexpr FVector DoorwayPosition = FVector(765.0f, 290.0f, 0.0f);
constexpr float DoorwayYaw = -90.0f;  // degrees
constexpr float DoorwayScale = 1.06f;

// ============================================================================
// Floor Tiles — Decorative Kenney Models
// ============================================================================

// --- Full Floor Tiles (along back wall) ---
// Three.js: floorFull at y=0.01, scale 1.02
constexpr float FloorTileScale = 1.02f;
constexpr float FloorTileZ = 1.0f;  // UE5 Z for y=0.01

constexpr FVector FloorFullPositions[] = {
    FVector(-580.0f, 415.0f, FloorTileZ),  // Three.js: (-5.8, 0.01, -4.15)
    FVector(-190.0f, 415.0f, FloorTileZ),  // Three.js: (-1.9, 0.01, -4.15)
    FVector( 190.0f, 415.0f, FloorTileZ),  // Three.js: ( 1.9, 0.01, -4.15)
    FVector( 580.0f, 415.0f, FloorTileZ),  // Three.js: ( 5.8, 0.01, -4.15)
};
constexpr int32 FloorFullCount = UE_ARRAY_COUNT(FloorFullPositions);

// --- Half Floor Tiles (along side walls) ---
// Three.js: floorHalf, scale 1.02
struct FFloorHalfTile
{
    FVector Position;
    float Yaw;  // degrees
};

constexpr FFloorHalfTile FloorHalfTiles[] = {
    { FVector(-695.0f,  205.0f, FloorTileZ),  90.0f },  // Three.js: (-6.95, 0.01, -2.05), rot PI/2
    { FVector(-695.0f, -175.0f, FloorTileZ),  90.0f },  // Three.js: (-6.95, 0.01,  1.75), rot PI/2
    { FVector( 695.0f,  205.0f, FloorTileZ), -90.0f },  // Three.js: ( 6.95, 0.01, -2.05), rot -PI/2
    { FVector( 695.0f, -175.0f, FloorTileZ), -90.0f },  // Three.js: ( 6.95, 0.01,  1.75), rot -PI/2
};
constexpr int32 FloorHalfCount = UE_ARRAY_COUNT(FloorHalfTiles);

// --- Corner Round Floor Tiles ---
// Three.js: floorCornerRound, scale 1.05
constexpr float FloorCornerScale = 1.05f;

struct FFloorCornerTile
{
    FVector Position;
    float Yaw;  // degrees
};

constexpr FFloorCornerTile FloorCornerTiles[] = {
    { FVector(-695.0f, 415.0f, FloorTileZ),  90.0f },  // Left-back corner, rot PI/2
    { FVector( 695.0f, 415.0f, FloorTileZ), 180.0f },  // Right-back corner, rot PI
};
constexpr int32 FloorCornerCount = UE_ARRAY_COUNT(FloorCornerTiles);

// ============================================================================
// Ceiling (Recommended — not present in Three.js)
// ============================================================================

/** Recommended ceiling at the top of the walls */
constexpr FVector CeilingPosition = FVector(0.0f, 0.0f, 300.0f);
constexpr float CeilingWidth = 1542.0f;   // Match back wall width
constexpr float CeilingDepth = 998.0f;    // Match side wall length
constexpr float CeilingThickness = 10.0f; // Thin slab

// ============================================================================
// Material Color References (Linear RGB, 0-1 range)
// ============================================================================

namespace Colors
{
    // Floor colors
    constexpr FLinearColor FloorMain   = FLinearColor(0.796f, 0.710f, 0.588f, 1.0f);  // #CBB596
    constexpr FLinearColor FloorMiddle = FLinearColor(0.847f, 0.761f, 0.647f, 1.0f);  // #D8C2A5
    constexpr FLinearColor FloorInner  = FLinearColor(0.894f, 0.824f, 0.729f, 1.0f);  // #E4D2BA

    // Wall colors
    constexpr FLinearColor BackWall  = FLinearColor(0.847f, 0.784f, 0.718f, 1.0f);  // #D8C8B7
    constexpr FLinearColor SideWall  = FLinearColor(0.824f, 0.761f, 0.698f, 1.0f);  // #D2C2B2

    // Baseboard colors
    constexpr FLinearColor BackBaseboard = FLinearColor(0.702f, 0.612f, 0.514f, 1.0f);  // #B39C83
    constexpr FLinearColor SideBaseboard = FLinearColor(0.682f, 0.596f, 0.506f, 1.0f);  // #AE9881

    // Shadow strip color
    constexpr FLinearColor WallShadow = FLinearColor(0.549f, 0.463f, 0.373f, 1.0f);  // #8C765F

    // Recommended ceiling color
    constexpr FLinearColor Ceiling = FLinearColor(0.941f, 0.910f, 0.867f, 1.0f);  // #F0E8DD
}

// ============================================================================
// Coordinate Conversion Helpers
// ============================================================================

/** Convert a Three.js position (Y-up, meters) to UE5 position (Z-up, cm). */
FORCEINLINE FVector ThreeJsToUE5(float X, float Y, float Z)
{
    return FVector(X * 100.0f, Z * -100.0f, Y * 100.0f);
}

/** Convert a Three.js size (Y-up, meters) to UE5 extent (Z-up, cm). */
FORCEINLINE FVector ThreeJsSizeToUE5(float SizeX, float SizeY, float SizeZ)
{
    return FVector(SizeX * 100.0f, SizeZ * 100.0f, SizeY * 100.0f);
}

/** Convert a Three.js Y-axis rotation (radians) to UE5 Yaw (degrees). */
FORCEINLINE float ThreeJsRotYToUE5Yaw(float RadiansY)
{
    return FMath::RadiansToDegrees(-RadiansY);
}

} // namespace RoomShell
} // namespace CubePets
