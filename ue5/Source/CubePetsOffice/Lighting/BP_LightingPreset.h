// Copyright WhyBuddy. All Rights Reserved.
//
// BP_LightingPreset — Blueprint-compatible lighting preset actor.
//
// This actor manages all scene lights and exposes preset switching via
// Blueprint-callable methods. Place one instance in the level to control
// the entire office lighting system.
//
// Usage in Blueprint:
//   1. Place BP_LightingPreset in the level
//   2. Assign light component references in the Details panel
//   3. Call ApplyPreset() to switch between day/night/meeting/presentation
//   4. Optionally call SetGlobalIntensityScale() or SetGlobalColorTempOverride()
//
// Usage via C++:
//   ABP_LightingPreset* Preset = GetWorld()->SpawnActor<ABP_LightingPreset>();
//   Preset->ApplyPreset(EBPLightingPresetType::Night);
//
// Source: ue5/docs/lighting-system.md
//         ue5/Source/CubePetsOffice/Lighting/LightingPresetData.h

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/RectLightComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PostProcessComponent.h"
#include "BP_LightingPreset.generated.h"

// ============================================================================
// Blueprint-Friendly Preset Enum
// ============================================================================

UENUM(BlueprintType)
enum class EBPLightingPresetType : uint8
{
    Day            UMETA(DisplayName = "Day"),
    Night          UMETA(DisplayName = "Night"),
    Meeting        UMETA(DisplayName = "Meeting"),
    Presentation   UMETA(DisplayName = "Presentation")
};

// ============================================================================
// Lighting Preset Actor
// ============================================================================

/**
 * ABP_LightingPreset
 *
 * A Blueprint-compatible actor that manages the office lighting system.
 * Supports four presets (day, night, meeting, presentation) and exposes
 * global intensity/color temperature overrides for runtime adjustment.
 *
 * All light references are soft — assign them in the editor or at runtime.
 * The actor reads preset data from LightingPresetData.h constants and
 * applies them to the referenced light components.
 */
UCLASS(Blueprintable, BlueprintType, meta = (DisplayName = "Lighting Preset Controller"))
class CUBEPETSOFFICE_API ABP_LightingPreset : public AActor
{
    GENERATED_BODY()

public:
    ABP_LightingPreset();

    // ========================================================================
    // Light Component References (assign in editor)
    // ========================================================================

    /** Main directional light simulating sunlight. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Main")
    TObjectPtr<UDirectionalLightComponent> DirectionalLight;

    /** Sky light for ambient fill. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Main")
    TObjectPtr<USkyLightComponent> SkyLight;

    /** Ceiling rect lights (6 total). Assign in order CL-1 through CL-6. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Ceiling")
    TArray<TObjectPtr<URectLightComponent>> CeilingLights;

    /** Floor lamp point light (from LoungeDecor area). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Local")
    TObjectPtr<UPointLightComponent> FloorLampLight;

    /** Wall lamp point light (from LoungeDecor area). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Local")
    TObjectPtr<UPointLightComponent> WallLampLight;

    /** Desk lamp point lights (4 total, optional). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Local")
    TArray<TObjectPtr<UPointLightComponent>> DeskLampLights;

    /** Post process component for exposure, bloom, vignette, color grading. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|PostProcess")
    TObjectPtr<UPostProcessComponent> PostProcessVolume;

    // ========================================================================
    // Current State
    // ========================================================================

    /** The currently active lighting preset. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Lighting|State")
    EBPLightingPresetType CurrentPreset;

    /** Global intensity multiplier (0.0 - 2.0). Applied on top of preset values. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Override",
              meta = (ClampMin = "0.0", ClampMax = "2.0", UIMin = "0.0", UIMax = "2.0"))
    float GlobalIntensityScale;

    /** Global color temperature override in Kelvin. 0 = use preset default. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Override",
              meta = (ClampMin = "0.0", ClampMax = "10000.0", UIMin = "2700.0", UIMax = "6500.0"))
    float GlobalColorTempOverride;

    /** Transition duration in seconds when switching presets. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Lighting|Transition",
              meta = (ClampMin = "0.0", ClampMax = "10.0", UIMin = "0.0", UIMax = "5.0"))
    float TransitionDuration;

    // ========================================================================
    // Blueprint-Callable Methods
    // ========================================================================

    /**
     * Apply a lighting preset. Smoothly transitions all lights over
     * TransitionDuration seconds.
     *
     * @param NewPreset  The preset to switch to.
     */
    UFUNCTION(BlueprintCallable, Category = "Lighting")
    void ApplyPreset(EBPLightingPresetType NewPreset);

    /**
     * Set the global intensity scale. Multiplied with all light intensities.
     *
     * @param Scale  Intensity multiplier (0.0 = all off, 1.0 = normal, 2.0 = double).
     */
    UFUNCTION(BlueprintCallable, Category = "Lighting")
    void SetGlobalIntensityScale(float Scale);

    /**
     * Override the global color temperature for all lights.
     * Pass 0 to revert to per-preset color temperatures.
     *
     * @param ColorTempKelvin  Color temperature in Kelvin (2700 - 6500), or 0 to disable.
     */
    UFUNCTION(BlueprintCallable, Category = "Lighting")
    void SetGlobalColorTempOverride(float ColorTempKelvin);

    /**
     * Get the currently active preset type.
     *
     * @return The current preset enum value.
     */
    UFUNCTION(BlueprintCallable, BlueprintPure, Category = "Lighting")
    EBPLightingPresetType GetCurrentPreset() const;

    /**
     * Immediately apply preset values without transition animation.
     * Useful for level initialization.
     *
     * @param NewPreset  The preset to apply instantly.
     */
    UFUNCTION(BlueprintCallable, Category = "Lighting")
    void ApplyPresetImmediate(EBPLightingPresetType NewPreset);

    // ========================================================================
    // Blueprint Events
    // ========================================================================

    /**
     * Called when a preset transition begins.
     *
     * @param FromPreset  The preset being transitioned from.
     * @param ToPreset    The preset being transitioned to.
     */
    UFUNCTION(BlueprintImplementableEvent, Category = "Lighting|Events")
    void OnPresetTransitionStarted(EBPLightingPresetType FromPreset,
                                   EBPLightingPresetType ToPreset);

    /**
     * Called when a preset transition completes.
     *
     * @param NewPreset  The newly active preset.
     */
    UFUNCTION(BlueprintImplementableEvent, Category = "Lighting|Events")
    void OnPresetTransitionCompleted(EBPLightingPresetType NewPreset);

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

private:
    /** Whether a transition is currently in progress. */
    bool bIsTransitioning;

    /** Elapsed time during the current transition. */
    float TransitionElapsed;

    /** The preset we are transitioning from. */
    EBPLightingPresetType TransitionFromPreset;

    /** The preset we are transitioning to. */
    EBPLightingPresetType TransitionToPreset;

    /**
     * Internal: Apply interpolated lighting values.
     *
     * @param Alpha  Blend factor (0.0 = FromPreset, 1.0 = ToPreset).
     */
    void ApplyInterpolatedLighting(float Alpha);

    /**
     * Internal: Apply a single preset's values to all light components.
     *
     * @param PresetType  The preset to read values from.
     */
    void ApplyPresetValues(EBPLightingPresetType PresetType);
};
