// Copyright WhyBuddy. All Rights Reserved.
//
// Lighting Preset Data — UE5-compatible constants for the office lighting
// system, including directional light, rect lights, point lights, four
// lighting presets (day / night / meeting / presentation), and Lumen GI
// quality settings.
//
// All positions are in centimeters (cm) using UE5 Z-up coordinate system.
// Color temperatures are in Kelvin (K).
// Intensities use UE5 physical units (lux for directional, cd for local).
//
// Point light parameters for the floor lamp and wall lamp are already
// defined in SceneLayout/LoungeDecorData.h — reference them directly
// rather than duplicating values here.
//
// Source: ue5/docs/lighting-system.md

#pragma once

#include "CoreMinimal.h"

namespace CubePets
{
namespace Lighting
{

// ============================================================================
// Lighting Preset Type Enum
// ============================================================================

enum class ELightingPresetType : uint8
{
    Day = 0,           // 日间办公
    Night,             // 夜间模式
    Meeting,           // 会议模式
    Presentation,      // 演示模式
    COUNT
};

// ============================================================================
// Directional Light Parameters (Main Sunlight)
// ============================================================================

struct FDirectionalLightParams
{
    float Pitch;              // degrees, negative = from above
    float Yaw;                // degrees
    float IntensityLux;       // UE5 Directional Light intensity in lux
    float ColorTemperature;   // Kelvin
    float SourceAngle;        // degrees, controls shadow softness
    bool  bCastShadows;
    bool  bAtmosphereSunLight;
};

// ============================================================================
// Sky Light Parameters
// ============================================================================

struct FSkyLightParams
{
    float Intensity;          // Sky light intensity multiplier
    bool  bRealTimeCapture;   // Use real-time sky capture
};

// ============================================================================
// Rect Light Parameters (Ceiling Office Lights)
// ============================================================================

struct FRectLightParams
{
    FVector Position;         // UE5 world position (cm)
    float   SourceWidth;      // cm
    float   SourceHeight;     // cm
    float   IntensityCd;      // candela
    float   ColorTemperature; // Kelvin
    float   AttenuationRadius;// cm
    float   BarnDoorAngle;    // degrees
    float   Pitch;            // rotation pitch (degrees), -90 = downward
    bool    bCastShadows;
};

/** 6 ceiling rect lights covering the office zones. */
constexpr int32 CeilingLightCount = 6;

/** Default ceiling rect light placements (used as base; presets override intensity/color). */
namespace CeilingLights
{
    // CL-1: Left work area
    constexpr FVector CL1_Position = FVector(-400.0f, 250.0f, 290.0f);
    // CL-2: Right work area
    constexpr FVector CL2_Position = FVector(400.0f, 250.0f, 290.0f);
    // CL-3: Left center
    constexpr FVector CL3_Position = FVector(-400.0f, -100.0f, 290.0f);
    // CL-4: Right center
    constexpr FVector CL4_Position = FVector(400.0f, -100.0f, 290.0f);
    // CL-5: Meeting area (above)
    constexpr FVector CL5_Position = FVector(0.0f, 350.0f, 290.0f);
    // CL-6: Lounge area (above)
    constexpr FVector CL6_Position = FVector(0.0f, -350.0f, 290.0f);

    constexpr FVector Positions[CeilingLightCount] = {
        CL1_Position, CL2_Position, CL3_Position,
        CL4_Position, CL5_Position, CL6_Position
    };

    // Common defaults
    constexpr float DefaultSourceWidth      = 120.0f;  // cm
    constexpr float DefaultSourceHeight     = 60.0f;   // cm
    constexpr float DefaultAttenuationRadius = 600.0f; // cm
    constexpr float DefaultBarnDoorAngle    = 60.0f;   // degrees
    constexpr float DefaultPitch            = -90.0f;  // downward
    constexpr bool  DefaultCastShadows      = true;
}

// ============================================================================
// Point Light Parameters (Desk Lamps — optional fill)
// ============================================================================
// Floor lamp and wall lamp point lights are defined in:
//   CubePets::LoungeDecor::FloorLamp::LightPosition / LightIntensity / LightColor / LightRadius
//   CubePets::LoungeDecor::WallLamp::LightPosition / LightIntensity / LightColor / LightRadius
// Reference those directly in blueprints.

struct FPointLightParams
{
    FVector      Position;
    float        IntensityCd;
    float        ColorTemperature;
    float        AttenuationRadius;
    float        SourceRadius;
    bool         bCastShadows;
};

/** Optional desk lamp positions for work area fill lighting. */
constexpr int32 DeskLampCount = 4;

namespace DeskLamps
{
    constexpr FVector DL1_Position = FVector(-350.0f, 200.0f, 100.0f);  // Left-front desk
    constexpr FVector DL2_Position = FVector(350.0f, 200.0f, 100.0f);   // Right-front desk
    constexpr FVector DL3_Position = FVector(-350.0f, 350.0f, 100.0f);  // Left-back desk
    constexpr FVector DL4_Position = FVector(350.0f, 350.0f, 100.0f);   // Right-back desk

    constexpr FVector Positions[DeskLampCount] = {
        DL1_Position, DL2_Position, DL3_Position, DL4_Position
    };

    constexpr float DefaultIntensityCd      = 500.0f;
    constexpr float DefaultColorTemperature = 3200.0f;  // K
    constexpr float DefaultAttenuationRadius = 200.0f;  // cm
    constexpr float DefaultSourceRadius     = 5.0f;     // cm
    constexpr bool  DefaultCastShadows      = false;
}

// ============================================================================
// Post Process Parameters (per preset)
// ============================================================================

struct FPostProcessParams
{
    float ExposureCompensation;
    float BloomIntensity;
    float VignetteIntensity;
    float WhiteBalanceTemp;       // Kelvin
    FLinearColor ShadowTint;      // Color grading shadow tint (1,1,1 = neutral)
};

// ============================================================================
// Complete Lighting Preset
// ============================================================================

struct FLightingPreset
{
    ELightingPresetType PresetType;

    // Main directional light
    FDirectionalLightParams DirectionalLight;

    // Sky light
    FSkyLightParams SkyLight;

    // Ceiling rect lights — per-preset intensity and color temp
    float CeilingLightIntensityCd;
    float CeilingLightColorTemp;
    // Meeting preset: CL-5 (index 4) gets a separate override
    float CeilingLightMeetingOverrideIntensityCd;
    float CeilingLightMeetingOverrideColorTemp;

    // Floor lamp (references LoungeDecor::FloorLamp base, preset scales)
    float FloorLampIntensityCd;
    float FloorLampColorTemp;

    // Wall lamp (references LoungeDecor::WallLamp base, preset scales)
    float WallLampIntensityCd;
    float WallLampColorTemp;

    // Desk lamps
    float DeskLampIntensityCd;
    float DeskLampColorTemp;

    // Post process
    FPostProcessParams PostProcess;
};

// ============================================================================
// Preset Definitions
// ============================================================================

namespace Presets
{

/** Day — Normal daytime office lighting. */
constexpr FLightingPreset Day = {
    ELightingPresetType::Day,
    // Directional Light
    { -45.0f, -30.0f, 8.0f, 6200.0f, 1.0f, true, true },
    // Sky Light
    { 1.5f, true },
    // Ceiling Rect Lights
    800.0f, 4800.0f,
    800.0f, 4800.0f,   // No special meeting override in day mode
    // Floor Lamp
    2000.0f, 2800.0f,
    // Wall Lamp
    800.0f, 2900.0f,
    // Desk Lamps
    500.0f, 3200.0f,
    // Post Process
    { 0.0f, 0.3f, 0.1f, 6200.0f, FLinearColor(1.0f, 1.0f, 1.0f, 1.0f) }
};

/** Night — Evening / overtime lighting, no sunlight. */
constexpr FLightingPreset Night = {
    ELightingPresetType::Night,
    // Directional Light — disabled
    { -45.0f, -30.0f, 0.0f, 6200.0f, 1.0f, false, false },
    // Sky Light — dim moonlight
    { 0.3f, true },
    // Ceiling Rect Lights
    600.0f, 3800.0f,
    600.0f, 3800.0f,
    // Floor Lamp — primary light source at night
    2500.0f, 2700.0f,
    // Wall Lamp — enhanced
    1200.0f, 2700.0f,
    // Desk Lamps — enhanced
    800.0f, 3000.0f,
    // Post Process
    { -1.0f, 0.6f, 0.3f, 3500.0f, FLinearColor(0.85f, 0.9f, 1.0f, 1.0f) }
};

/** Meeting — Conference-focused lighting. */
constexpr FLightingPreset Meeting = {
    ELightingPresetType::Meeting,
    // Directional Light — reduced
    { -45.0f, -30.0f, 4.0f, 5500.0f, 1.0f, true, true },
    // Sky Light
    { 1.0f, true },
    // Ceiling Rect Lights — general reduced
    400.0f, 4500.0f,
    // CL-5 meeting area override — boosted
    1200.0f, 5000.0f,
    // Floor Lamp — reduced
    1000.0f, 3000.0f,
    // Wall Lamp
    600.0f, 3000.0f,
    // Desk Lamps — reduced
    200.0f, 3200.0f,
    // Post Process
    { 0.0f, 0.2f, 0.05f, 5200.0f, FLinearColor(1.0f, 1.0f, 1.0f, 1.0f) }
};

/** Presentation — Projector-friendly dim lighting. */
constexpr FLightingPreset Presentation = {
    ELightingPresetType::Presentation,
    // Directional Light — very low
    { -45.0f, -30.0f, 1.0f, 5000.0f, 1.0f, true, true },
    // Sky Light — low
    { 0.5f, true },
    // Ceiling Rect Lights — very dim
    100.0f, 4000.0f,
    // CL-5 meeting area — slightly brighter
    200.0f, 4000.0f,
    // Floor Lamp — low
    500.0f, 2700.0f,
    // Wall Lamp — low
    300.0f, 2700.0f,
    // Desk Lamps — off
    0.0f, 3200.0f,
    // Post Process
    { -1.5f, 0.8f, 0.4f, 4500.0f, FLinearColor(0.8f, 0.85f, 1.0f, 1.0f) }
};

/** Lookup table for all presets by enum index. */
constexpr const FLightingPreset* AllPresets[] = {
    &Day,
    &Night,
    &Meeting,
    &Presentation
};

/** Get a preset by type. Returns Day preset as fallback. */
inline const FLightingPreset& GetPreset(ELightingPresetType Type)
{
    const int32 Index = static_cast<int32>(Type);
    if (Index >= 0 && Index < static_cast<int32>(ELightingPresetType::COUNT))
    {
        return *AllPresets[Index];
    }
    return Day;
}

} // namespace Presets

// ============================================================================
// Lumen GI Quality Settings
// ============================================================================

struct FLumenGISettings
{
    float SceneLightingQuality;   // 0.25 (low) to 4.0 (cinematic)
    float SceneDetail;            // Scene detail level
    float SceneViewDistance;       // cm
    float FinalGatherQuality;     // 0.25 to 4.0
    float FinalGatherLightingUpdateSpeed; // 0.0 to 1.0
    float MaxTraceDistance;        // cm
    float ReflectionQuality;      // 0.25 to 4.0
    float MaxRoughnessToTrace;    // 0.0 to 1.0
    bool  bSoftwareRayTracing;
    bool  bHardwareRayTracing;
};

namespace LumenQuality
{

/** Low quality — targeting GTX 1060 at 30fps. */
constexpr FLumenGISettings Low = {
    0.5f,       // SceneLightingQuality
    0.5f,       // SceneDetail
    20000.0f,   // SceneViewDistance (200m)
    0.5f,       // FinalGatherQuality
    0.5f,       // FinalGatherLightingUpdateSpeed
    20000.0f,   // MaxTraceDistance
    0.5f,       // ReflectionQuality
    0.4f,       // MaxRoughnessToTrace
    true,       // SoftwareRayTracing
    false       // HardwareRayTracing
};

/** Medium quality — balanced for mid-range GPUs. */
constexpr FLumenGISettings Medium = {
    1.0f,       // SceneLightingQuality
    1.0f,       // SceneDetail
    20000.0f,   // SceneViewDistance
    1.0f,       // FinalGatherQuality
    0.5f,       // FinalGatherLightingUpdateSpeed
    20000.0f,   // MaxTraceDistance
    1.0f,       // ReflectionQuality
    0.4f,       // MaxRoughnessToTrace
    true,       // SoftwareRayTracing
    false       // HardwareRayTracing
};

/** High quality — for RTX GPUs with hardware ray tracing. */
constexpr FLumenGISettings High = {
    1.5f,       // SceneLightingQuality
    1.5f,       // SceneDetail
    20000.0f,   // SceneViewDistance
    1.5f,       // FinalGatherQuality
    0.5f,       // FinalGatherLightingUpdateSpeed
    20000.0f,   // MaxTraceDistance
    1.0f,       // ReflectionQuality
    0.4f,       // MaxRoughnessToTrace
    true,       // SoftwareRayTracing
    true        // HardwareRayTracing
};

} // namespace LumenQuality

// ============================================================================
// Color Temperature Helpers
// ============================================================================

/**
 * Approximate a color temperature (Kelvin) to a linear RGB color.
 * Uses Tanner Helland's algorithm for the 1000K-40000K range.
 * For use in editor or runtime when UseTemperature is not available.
 */
FORCEINLINE FLinearColor ColorTemperatureToLinear(float TempKelvin)
{
    const float Temp = FMath::Clamp(TempKelvin, 1000.0f, 40000.0f) / 100.0f;
    float R, G, B;

    // Red
    if (Temp <= 66.0f)
    {
        R = 1.0f;
    }
    else
    {
        R = FMath::Clamp(1.292936f * FMath::Pow(Temp - 60.0f, -0.1332047f), 0.0f, 1.0f);
    }

    // Green
    if (Temp <= 66.0f)
    {
        G = FMath::Clamp(0.390082f * FMath::Loge(Temp) - 0.631841f, 0.0f, 1.0f);
    }
    else
    {
        G = FMath::Clamp(1.129891f * FMath::Pow(Temp - 60.0f, -0.0755148f), 0.0f, 1.0f);
    }

    // Blue
    if (Temp >= 66.0f)
    {
        B = 1.0f;
    }
    else if (Temp <= 19.0f)
    {
        B = 0.0f;
    }
    else
    {
        B = FMath::Clamp(0.543207f * FMath::Loge(Temp - 10.0f) - 1.196254f, 0.0f, 1.0f);
    }

    return FLinearColor(R, G, B, 1.0f);
}

} // namespace Lighting
} // namespace CubePets
