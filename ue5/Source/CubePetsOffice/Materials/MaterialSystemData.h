// Copyright WhyBuddy. All Rights Reserved.
//
// Material System Data — UE5-compatible constants for the office material
// system, including Master Material parameter names, color definitions for
// all material instances, and material assignment mapping structs.
//
// The Master Material (MM_Office_Master) supports three modes:
//   1. Pure color (Tint + scalar Roughness/Metallic) — default for low-poly
//   2. Texture-based PBR (BaseColor/Normal/ORM textures)
//   3. Vertex Color mode — for Kenney Furniture Kit models
//
// All colors are in linear space (FLinearColor). Use FLinearColor::FromSRGBColor
// or the HexToLinear helper to convert from sRGB hex values.
//
// Source: ue5/docs/material-system.md

#pragma once

#include "CoreMinimal.h"

namespace CubePets
{
namespace Materials
{

// ============================================================================
// Material Parameter Name Constants
// ============================================================================
// These FName constants match the parameter names exposed by MM_Office_Master.
// Use them when setting Material Instance Dynamic parameters at runtime or
// when configuring Material Instance assets in the editor.

namespace ParamNames
{
    // --- Color / Texture Parameters ---
    static const FName BaseColorTint        = TEXT("BaseColorTint");
    static const FName BaseColorTexture     = TEXT("BaseColorTexture");
    static const FName NormalTexture         = TEXT("NormalTexture");
    static const FName NormalIntensity       = TEXT("NormalIntensity");
    static const FName ORMTexture            = TEXT("ORMTexture");

    // --- Scalar PBR Parameters ---
    static const FName Roughness             = TEXT("Roughness");
    static const FName Metallic              = TEXT("Metallic");
    static const FName AmbientOcclusion      = TEXT("AmbientOcclusion");

    // --- Emissive Parameters ---
    static const FName EmissiveColor         = TEXT("EmissiveColor");
    static const FName EmissiveIntensity     = TEXT("EmissiveIntensity");

    // --- Opacity ---
    static const FName Opacity               = TEXT("Opacity");

    // --- Vertex Color Parameters ---
    static const FName UseVertexColor        = TEXT("UseVertexColor");
    static const FName VertexColorIntensity  = TEXT("VertexColorIntensity");

    // --- Texture Toggle ---
    static const FName UseTextures           = TEXT("UseTextures");

    // --- UV Parameters ---
    static const FName UVTiling              = TEXT("UVTiling");

} // namespace ParamNames

// ============================================================================
// sRGB Hex to Linear Color Helper
// ============================================================================

/**
 * Convert a 24-bit sRGB hex color (0xRRGGBB) to FLinearColor.
 * Alpha defaults to 1.0.
 */
FORCEINLINE FLinearColor HexToLinear(uint32 Hex, float Alpha = 1.0f)
{
    const float R = FMath::Pow(static_cast<float>((Hex >> 16) & 0xFF) / 255.0f, 2.2f);
    const float G = FMath::Pow(static_cast<float>((Hex >> 8)  & 0xFF) / 255.0f, 2.2f);
    const float B = FMath::Pow(static_cast<float>((Hex)       & 0xFF) / 255.0f, 2.2f);
    return FLinearColor(R, G, B, Alpha);
}

// ============================================================================
// Color Definitions — Wood
// ============================================================================

namespace Colors
{
namespace Wood
{
    /** MI_Wood_Light — #CBB596 — Light wood for desk tops, shelves */
    static const FLinearColor Light     = HexToLinear(0xCBB596);
    /** MI_Wood_Dark — #8C765F — Dark wood for legs, whiteboard frames */
    static const FLinearColor Dark      = HexToLinear(0x8C765F);
    /** MI_Wood_Warm — #8E775F — Warm wood for decorative boxes, bookcases */
    static const FLinearColor Warm      = HexToLinear(0x8E775F);
    /** MI_Wood_Rich — #90755B — Rich warm wood for whiteboard bases */
    static const FLinearColor Rich      = HexToLinear(0x90755B);
    /** MI_Wood_Leg — #6F5B48 — Deep wood for structural legs */
    static const FLinearColor Leg       = HexToLinear(0x6F5B48);
} // namespace Wood

// ============================================================================
// Color Definitions — Fabric
// ============================================================================

namespace Fabric
{
    /** MI_Fabric_Blue — #2563EB — Blue fabric for office chair cushions */
    static const FLinearColor Blue      = HexToLinear(0x2563EB);
    /** MI_Fabric_Gray — #6B7280 — Gray fabric for sofas */
    static const FLinearColor Gray      = HexToLinear(0x6B7280);
    /** MI_Fabric_Orange — #D97706 — Orange fabric for accent cushions */
    static const FLinearColor Orange    = HexToLinear(0xD97706);
    /** MI_Fabric_Green — #059669 — Green fabric for lounge chairs */
    static const FLinearColor Green     = HexToLinear(0x059669);
    /** MI_Fabric_Purple — #7C3AED — Purple fabric for decorative elements */
    static const FLinearColor Purple    = HexToLinear(0x7C3AED);
} // namespace Fabric

// ============================================================================
// Color Definitions — Metal
// ============================================================================

namespace Metal
{
    /** MI_Metal_Chrome — #C0C0C0 — Chrome for chair bases, lamp frames */
    static const FLinearColor Chrome     = HexToLinear(0xC0C0C0);
    /** MI_Metal_Brushed — #A0A0A0 — Brushed metal for desk hardware */
    static const FLinearColor Brushed    = HexToLinear(0xA0A0A0);
    /** MI_Metal_DarkSteel — #56483D — Dark steel for casters, small hardware */
    static const FLinearColor DarkSteel  = HexToLinear(0x56483D);
    /** MI_Metal_Brass — #8B6914 — Brass for frames, decorative trim */
    static const FLinearColor Brass      = HexToLinear(0x8B6914);
} // namespace Metal

// ============================================================================
// Color Definitions — Plastic
// ============================================================================

namespace Plastic
{
    /** MI_Plastic_White — #F9F7F2 — White plastic for keyboards, mice */
    static const FLinearColor White      = HexToLinear(0xF9F7F2);
    /** MI_Plastic_Black — #2D2D2D — Black plastic for monitor housings */
    static const FLinearColor Black      = HexToLinear(0x2D2D2D);
    /** MI_Plastic_Cream — #FFF5E2 — Cream plastic for decorative items */
    static const FLinearColor Cream      = HexToLinear(0xFFF5E2);
} // namespace Plastic

// ============================================================================
// Color Definitions — Walls & Architecture
// ============================================================================

namespace Wall
{
    /** MI_Wall_Back — #D8C8B7 — Back wall */
    static const FLinearColor Back       = HexToLinear(0xD8C8B7);
    /** MI_Wall_Side — #D2C2B2 — Side walls (left & right) */
    static const FLinearColor Side       = HexToLinear(0xD2C2B2);
    /** MI_Baseboard_Back — #B39C83 — Back wall baseboard */
    static const FLinearColor BaseboardBack = HexToLinear(0xB39C83);
    /** MI_Baseboard_Side — #AE9881 — Side wall baseboard */
    static const FLinearColor BaseboardSide = HexToLinear(0xAE9881);
} // namespace Wall

// ============================================================================
// Color Definitions — Floor
// ============================================================================

namespace Floor
{
    /** MI_Floor_Outer — #CBB596 — Outer floor layer */
    static const FLinearColor Outer      = HexToLinear(0xCBB596);
    /** MI_Floor_Middle — #D8C2A5 — Middle floor layer */
    static const FLinearColor Middle     = HexToLinear(0xD8C2A5);
    /** MI_Floor_Inner — #E4D2BA — Inner floor layer (semi-transparent) */
    static const FLinearColor Inner      = HexToLinear(0xE4D2BA);
    /** MI_Floor_Shadow — #8C765F — Floor shadow stripes */
    static const FLinearColor Shadow     = HexToLinear(0x8C765F);
} // namespace Floor

// ============================================================================
// Color Definitions — Special Surfaces
// ============================================================================

namespace Special
{
    /** MI_Cork — #C4956A — Cork board surface */
    static const FLinearColor Cork       = HexToLinear(0xC4956A);
    /** MI_Frame_Brass — #8B6914 — Brass frame / cork board border */
    static const FLinearColor FrameBrass = HexToLinear(0x8B6914);
    /** MI_Whiteboard — #F9F7F2 — Whiteboard surface */
    static const FLinearColor Whiteboard = HexToLinear(0xF9F7F2);
    /** MI_Glass_Frosted — #EDF4FB — Frosted glass partition */
    static const FLinearColor GlassFrosted = HexToLinear(0xEDF4FB);
} // namespace Special

// ============================================================================
// Color Definitions — Sticky Notes
// ============================================================================

namespace StickyNote
{
    /** MI_StickyNote_Yellow — #FFE4B5 */
    static const FLinearColor Yellow     = HexToLinear(0xFFE4B5);
    /** MI_StickyNote_Blue — #E3F2FD */
    static const FLinearColor Blue       = HexToLinear(0xE3F2FD);
    /** MI_StickyNote_Gold — #FDE68A */
    static const FLinearColor Gold       = HexToLinear(0xFDE68A);
    /** MI_StickyNote_LightBlue — #BFDBFE */
    static const FLinearColor LightBlue  = HexToLinear(0xBFDBFE);
    /** MI_StickyNote_Pink — #FBCFE8 */
    static const FLinearColor Pink       = HexToLinear(0xFBCFE8);
} // namespace StickyNote

// ============================================================================
// Color Definitions — Department / Zone Colors
// ============================================================================

namespace Zone
{
    /** Department zone A — #D97706 (Orange) */
    static const FLinearColor ZoneA      = HexToLinear(0xD97706);
    /** Department zone B — #2563EB (Blue) */
    static const FLinearColor ZoneB      = HexToLinear(0x2563EB);
    /** Department zone C — #059669 (Green) */
    static const FLinearColor ZoneC      = HexToLinear(0x059669);
    /** Department zone D — #7C3AED (Purple) */
    static const FLinearColor ZoneD      = HexToLinear(0x7C3AED);

    constexpr int32 ZoneCount = 4;
} // namespace Zone

} // namespace Colors

// ============================================================================
// Material Instance Parameters Struct
// ============================================================================

/**
 * Describes the parameters needed to configure a Material Instance from
 * MM_Office_Master. Used for data-driven material setup.
 */
struct FMaterialInstanceParams
{
    /** Display name for editor reference (not a runtime parameter). */
    FName InstanceName;

    /** Base color tint (sRGB converted to linear). */
    FLinearColor BaseColorTint = FLinearColor::White;

    /** PBR scalar overrides (used when UseTextures = false). */
    float Roughness       = 0.8f;
    float Metallic        = 0.0f;
    float AmbientOcclusion = 1.0f;

    /** Opacity (1.0 = fully opaque). */
    float Opacity         = 1.0f;

    /** Emissive. */
    FLinearColor EmissiveColor = FLinearColor::Black;
    float EmissiveIntensity    = 0.0f;

    /** Vertex color mode (for Kenney models). */
    bool  bUseVertexColor      = false;
    float VertexColorIntensity = 1.0f;

    /** Texture mode. */
    bool  bUseTextures         = false;

    /** Normal intensity. */
    float NormalIntensity      = 1.0f;

    /** UV tiling. */
    FVector2D UVTiling = FVector2D(1.0f, 1.0f);
};

// ============================================================================
// Pre-defined Material Instance Parameter Sets
// ============================================================================

namespace InstanceParams
{

// --- Wood ---
static const FMaterialInstanceParams WoodLight = {
    TEXT("MI_Wood_Light"), Colors::Wood::Light, 0.84f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams WoodDark = {
    TEXT("MI_Wood_Dark"), Colors::Wood::Dark, 0.84f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams WoodWarm = {
    TEXT("MI_Wood_Warm"), Colors::Wood::Warm, 0.82f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams WoodRich = {
    TEXT("MI_Wood_Rich"), Colors::Wood::Rich, 0.86f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams WoodLeg = {
    TEXT("MI_Wood_Leg"), Colors::Wood::Leg, 0.86f, 0.0f, 1.0f, 1.0f
};

// --- Fabric ---
static const FMaterialInstanceParams FabricBlue = {
    TEXT("MI_Fabric_Blue"), Colors::Fabric::Blue, 0.92f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FabricGray = {
    TEXT("MI_Fabric_Gray"), Colors::Fabric::Gray, 0.92f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FabricOrange = {
    TEXT("MI_Fabric_Orange"), Colors::Fabric::Orange, 0.90f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FabricGreen = {
    TEXT("MI_Fabric_Green"), Colors::Fabric::Green, 0.90f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FabricPurple = {
    TEXT("MI_Fabric_Purple"), Colors::Fabric::Purple, 0.90f, 0.0f, 1.0f, 1.0f
};

// --- Metal ---
static const FMaterialInstanceParams MetalChrome = {
    TEXT("MI_Metal_Chrome"), Colors::Metal::Chrome, 0.25f, 0.90f, 1.0f, 1.0f
};
static const FMaterialInstanceParams MetalBrushed = {
    TEXT("MI_Metal_Brushed"), Colors::Metal::Brushed, 0.45f, 0.80f, 1.0f, 1.0f
};
static const FMaterialInstanceParams MetalDarkSteel = {
    TEXT("MI_Metal_DarkSteel"), Colors::Metal::DarkSteel, 0.56f, 0.12f, 1.0f, 1.0f
};
static const FMaterialInstanceParams MetalBrass = {
    TEXT("MI_Metal_Brass"), Colors::Metal::Brass, 0.70f, 0.60f, 1.0f, 1.0f
};

// --- Plastic ---
static const FMaterialInstanceParams PlasticWhite = {
    TEXT("MI_Plastic_White"), Colors::Plastic::White, 0.72f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams PlasticBlack = {
    TEXT("MI_Plastic_Black"), Colors::Plastic::Black, 0.68f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams PlasticCream = {
    TEXT("MI_Plastic_Cream"), Colors::Plastic::Cream, 0.52f, 0.0f, 1.0f, 1.0f
};

// --- Walls ---
static const FMaterialInstanceParams WallBack = {
    TEXT("MI_Wall_Back"), Colors::Wall::Back, 0.98f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams WallSide = {
    TEXT("MI_Wall_Side"), Colors::Wall::Side, 0.98f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams BaseboardBack = {
    TEXT("MI_Baseboard_Back"), Colors::Wall::BaseboardBack, 1.0f, 0.0f, 1.0f, 0.72f
};
static const FMaterialInstanceParams BaseboardSide = {
    TEXT("MI_Baseboard_Side"), Colors::Wall::BaseboardSide, 1.0f, 0.0f, 1.0f, 0.64f
};

// --- Floor ---
static const FMaterialInstanceParams FloorOuter = {
    TEXT("MI_Floor_Outer"), Colors::Floor::Outer, 0.90f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FloorMiddle = {
    TEXT("MI_Floor_Middle"), Colors::Floor::Middle, 0.94f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FloorInner = {
    TEXT("MI_Floor_Inner"), Colors::Floor::Inner, 0.98f, 0.0f, 1.0f, 0.62f
};
static const FMaterialInstanceParams FloorShadow = {
    TEXT("MI_Floor_Shadow"), Colors::Floor::Shadow, 0.90f, 0.0f, 1.0f, 0.14f
};

// --- Special ---
static const FMaterialInstanceParams Cork = {
    TEXT("MI_Cork"), Colors::Special::Cork, 0.95f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams FrameBrass = {
    TEXT("MI_Frame_Brass"), Colors::Special::FrameBrass, 0.70f, 0.60f, 1.0f, 1.0f
};
static const FMaterialInstanceParams Whiteboard = {
    TEXT("MI_Whiteboard"), Colors::Special::Whiteboard, 0.92f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams GlassFrosted = {
    TEXT("MI_Glass_Frosted"), Colors::Special::GlassFrosted, 0.25f, 0.12f, 1.0f, 0.28f
};

// --- Sticky Notes ---
static const FMaterialInstanceParams StickyNoteYellow = {
    TEXT("MI_StickyNote_Yellow"), Colors::StickyNote::Yellow, 0.90f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams StickyNoteBlue = {
    TEXT("MI_StickyNote_Blue"), Colors::StickyNote::Blue, 0.90f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams StickyNoteGold = {
    TEXT("MI_StickyNote_Gold"), Colors::StickyNote::Gold, 0.88f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams StickyNoteLightBlue = {
    TEXT("MI_StickyNote_LightBlue"), Colors::StickyNote::LightBlue, 0.88f, 0.0f, 1.0f, 1.0f
};
static const FMaterialInstanceParams StickyNotePink = {
    TEXT("MI_StickyNote_Pink"), Colors::StickyNote::Pink, 0.88f, 0.0f, 1.0f, 1.0f
};

// --- Kenney Vertex Color ---
static const FMaterialInstanceParams KenneyDefault = {
    TEXT("MI_Kenney_Default"),
    FLinearColor::White,  // Tint = white (no tint override)
    0.80f,                // Roughness
    0.0f,                 // Metallic
    1.0f,                 // AO
    1.0f,                 // Opacity
    FLinearColor::Black,  // EmissiveColor
    0.0f,                 // EmissiveIntensity
    true,                 // bUseVertexColor
    1.0f,                 // VertexColorIntensity
    false,                // bUseTextures
    1.0f,                 // NormalIntensity
    FVector2D(1.0f, 1.0f) // UVTiling
};

static const FMaterialInstanceParams KenneyMatte = {
    TEXT("MI_Kenney_Matte"),
    FLinearColor::White,
    0.92f,                // Higher roughness for matte look
    0.0f,
    1.0f,
    1.0f,
    FLinearColor::Black,
    0.0f,
    true,                 // bUseVertexColor
    0.9f,                 // Slightly reduced vertex color intensity
    false,
    1.0f,
    FVector2D(1.0f, 1.0f)
};

} // namespace InstanceParams

// ============================================================================
// Material Assignment Mapping
// ============================================================================

/**
 * Maps a furniture model (by asset name) to one or more material instances.
 * Used for data-driven material assignment during scene setup.
 */
struct FMaterialAssignment
{
    /** Static Mesh asset name (e.g., "SM_Desk_01"). */
    FName MeshName;

    /** Primary material instance name. */
    FName PrimaryMaterial;

    /** Optional secondary material instance (for multi-slot meshes). */
    FName SecondaryMaterial;

    /** Description of the assignment. */
    const TCHAR* Description;
};

/**
 * Default material assignments for all office furniture.
 *
 * Kenney models use MI_Kenney_Default (vertex color mode).
 * Custom geometry (walls, floors, etc.) uses specific color instances.
 */
namespace Assignments
{

// --- Work Area ---
static const FMaterialAssignment Desk = {
    TEXT("SM_Desk_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Office desk — Kenney vertex color")
};
static const FMaterialAssignment ChairOffice = {
    TEXT("SM_Chair_Office_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Office chair — Kenney vertex color")
};
static const FMaterialAssignment Monitor = {
    TEXT("SM_Monitor_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Computer monitor — Kenney vertex color")
};
static const FMaterialAssignment Keyboard = {
    TEXT("SM_Keyboard_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Keyboard — Kenney vertex color")
};
static const FMaterialAssignment Mouse = {
    TEXT("SM_Mouse_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Mouse — Kenney vertex color")
};
static const FMaterialAssignment Laptop = {
    TEXT("SM_Laptop_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Laptop — Kenney vertex color")
};
static const FMaterialAssignment LampTable = {
    TEXT("SM_Lamp_Table_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Table lamp — Kenney vertex color")
};

// --- Meeting Area ---
static const FMaterialAssignment TableMeeting = {
    TEXT("SM_Table_Meeting_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Meeting table — Kenney vertex color")
};
static const FMaterialAssignment ChairRounded = {
    TEXT("SM_Chair_Rounded_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Rounded chair — Kenney vertex color")
};
static const FMaterialAssignment WhiteboardSurface = {
    TEXT("SM_Whiteboard_01"), TEXT("MI_Whiteboard"), TEXT("MI_Wood_Dark"),
    TEXT("Whiteboard — white surface + dark wood frame")
};

// --- Lounge Area ---
static const FMaterialAssignment Sofa = {
    TEXT("SM_Sofa_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Sofa — Kenney vertex color")
};
static const FMaterialAssignment ChairLounge = {
    TEXT("SM_Chair_Lounge_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Lounge chair — Kenney vertex color")
};
static const FMaterialAssignment TableCoffee = {
    TEXT("SM_Table_Coffee_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Coffee table — Kenney vertex color")
};
static const FMaterialAssignment SideTable = {
    TEXT("SM_SideTable_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Side table — Kenney vertex color")
};

// --- Corridor & Decor ---
static const FMaterialAssignment Shelf = {
    TEXT("SM_Shelf_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Bookshelf — Kenney vertex color")
};
static const FMaterialAssignment Books = {
    TEXT("SM_Books_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Books — Kenney vertex color")
};
static const FMaterialAssignment CoatRack = {
    TEXT("SM_CoatRack_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Coat rack — Kenney vertex color")
};
static const FMaterialAssignment LampFloor = {
    TEXT("SM_Lamp_Floor_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Floor lamp — Kenney vertex color")
};
static const FMaterialAssignment LampWall = {
    TEXT("SM_Lamp_Wall_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Wall lamp — Kenney vertex color")
};
static const FMaterialAssignment Plant = {
    TEXT("SM_Plant_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Potted plant — Kenney vertex color")
};

// --- Architecture (custom geometry, not Kenney) ---
static const FMaterialAssignment WallBack = {
    TEXT("Wall_Back"), TEXT("MI_Wall_Back"), NAME_None,
    TEXT("Back wall — custom geometry")
};
static const FMaterialAssignment WallSideLeft = {
    TEXT("Wall_Side_Left"), TEXT("MI_Wall_Side"), NAME_None,
    TEXT("Left side wall — custom geometry")
};
static const FMaterialAssignment WallSideRight = {
    TEXT("Wall_Side_Right"), TEXT("MI_Wall_Side"), NAME_None,
    TEXT("Right side wall — custom geometry")
};
static const FMaterialAssignment BaseboardBackWall = {
    TEXT("Baseboard_Back"), TEXT("MI_Baseboard_Back"), NAME_None,
    TEXT("Back wall baseboard — custom geometry")
};
static const FMaterialAssignment BaseboardSideWall = {
    TEXT("Baseboard_Side"), TEXT("MI_Baseboard_Side"), NAME_None,
    TEXT("Side wall baseboard — custom geometry")
};
static const FMaterialAssignment FloorOuterLayer = {
    TEXT("Floor_Outer"), TEXT("MI_Floor_Outer"), NAME_None,
    TEXT("Outer floor layer — custom geometry")
};
static const FMaterialAssignment FloorMiddleLayer = {
    TEXT("Floor_Middle"), TEXT("MI_Floor_Middle"), NAME_None,
    TEXT("Middle floor layer — custom geometry")
};
static const FMaterialAssignment FloorInnerLayer = {
    TEXT("Floor_Inner"), TEXT("MI_Floor_Inner"), NAME_None,
    TEXT("Inner floor layer — custom geometry")
};
static const FMaterialAssignment CorkBoard = {
    TEXT("CorkBoard"), TEXT("MI_Cork"), TEXT("MI_Frame_Brass"),
    TEXT("Cork board — cork surface + brass frame")
};
static const FMaterialAssignment DoorFrame = {
    TEXT("SM_DoorFrame_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Door frame — Kenney vertex color")
};
static const FMaterialAssignment WallCorner = {
    TEXT("SM_WallCorner_01"), TEXT("MI_Kenney_Default"), NAME_None,
    TEXT("Wall corner piece — Kenney vertex color")
};

} // namespace Assignments

// ============================================================================
// Texture Resolution Guidelines
// ============================================================================

namespace TextureGuidelines
{
    /** Primary furniture (desks, chairs, sofas) — close-up objects. */
    constexpr int32 PrimaryFurnitureRes   = 2048;
    /** Small props (keyboards, mice, books). */
    constexpr int32 SmallPropsRes         = 1024;
    /** Background / distant objects (far plants, wall corners). */
    constexpr int32 BackgroundRes         = 512;
    /** Large surfaces (floors, walls). */
    constexpr int32 LargeSurfaceRes       = 2048;
    /** Tiny elements (sticky notes, labels). */
    constexpr int32 TinyElementRes        = 256;
} // namespace TextureGuidelines

} // namespace Materials
} // namespace CubePets
