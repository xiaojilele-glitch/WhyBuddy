"""
Blender Python 脚本：批量将 GLTF/GLB 模型转换为 FBX 格式
用于 WhyBuddy UE5 项目的 Kenney Furniture Kit 模型导入准备

使用方法：
  blender --background --python ue5/Scripts/batch_import.py -- \
    --input "client/public/kenney_furniture-kit/Models/GLTF format" \
    --output "ue5/Import/FBX" \
    --scale 100

参数说明：
  --input   GLTF/GLB 源文件目录路径
  --output  FBX 输出目录路径
  --scale   缩放因子（默认 100，Three.js 米 → UE5 厘米）
  --filter  可选，仅转换匹配的文件名（逗号分隔，如 "desk,chair"）

依赖：
  Blender 4.0+ （需要支持 glTF 2.0 导入和 FBX 导出）
"""

import bpy
import os
import sys
import argparse
import time


# ─── Three.js 模型名 → UE5 资产名映射表 ───────────────────────────────────

ASSET_NAME_MAP = {
    # 办公家具
    "desk": "SM_Desk_01",
    "chairDesk": "SM_Chair_Desk_01",
    "chairRounded": "SM_Chair_Rounded_01",
    "chairModernCushion": "SM_Chair_ModernCushion_01",
    # 电脑设备
    "computerScreen": "SM_Monitor_01",
    "computerKeyboard": "SM_Keyboard_01",
    "computerMouse": "SM_Mouse_01",
    "laptop": "SM_Laptop_01",
    # 桌类
    "tableRound": "SM_Table_Round_01",
    "tableCoffeeSquare": "SM_Table_CoffeeSquare_01",
    "tableCoffee": "SM_Table_Coffee_01",
    "sideTable": "SM_SideTable_01",
    # 休息区
    "loungeSofaLong": "SM_Sofa_Long_01",
    "loungeSofa": "SM_Sofa_01",
    "loungeChair": "SM_Lounge_Chair_01",
    # 收纳
    "bookcaseOpen": "SM_Bookcase_Open_01",
    "bookcaseOpenLow": "SM_Bookcase_OpenLow_01",
    "books": "SM_Books_01",
    "coatRackStanding": "SM_CoatRack_Standing_01",
    # 地毯
    "rugRounded": "SM_Rug_Rounded_01",
    "rugRectangle": "SM_Rug_Rectangle_01",
    # 植物
    "pottedPlant": "SM_Plant_Potted_01",
    "plantSmall1": "SM_Plant_Small_01",
    "plantSmall2": "SM_Plant_Small_02",
    "plantSmall3": "SM_Plant_Small_03",
    # 灯具
    "lampRoundFloor": "SM_Lamp_Floor_01",
    "lampRoundTable": "SM_Lamp_Table_01",
    "lampWall": "SM_Lamp_Wall_01",
    # 建筑元素 — 墙体
    "wall": "SM_Wall_01",
    "wallCorner": "SM_Wall_Corner_01",
    "wallCornerRond": "SM_Wall_CornerRound_01",
    "wallDoorway": "SM_Wall_Doorway_01",
    "wallDoorwayWide": "SM_Wall_DoorwayWide_01",
    "wallHalf": "SM_Wall_Half_01",
    "wallWindow": "SM_Wall_Window_01",
    "wallWindowSlide": "SM_Wall_WindowSlide_01",
    # 地板
    "floorFull": "SM_Floor_Full_01",
    "floorHalf": "SM_Floor_Half_01",
    "floorCornerRound": "SM_Floor_CornerRound_01",
    "floorCorner": "SM_Floor_Corner_01",
    # 其他
    "paneling": "SM_Paneling_01",
}


def clear_scene():
    """清空当前 Blender 场景中的所有对象"""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # 清理孤立数据块
    for block_type in [bpy.data.meshes, bpy.data.materials, bpy.data.textures,
                       bpy.data.images, bpy.data.cameras, bpy.data.lights]:
        for block in block_type:
            if block.users == 0:
                block_type.remove(block)


def import_gltf(filepath):
    """导入 GLTF/GLB 文件"""
    bpy.ops.import_scene.gltf(filepath=filepath)


def apply_scale(scale_factor):
    """对场景中所有网格对象应用缩放"""
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj

    # 选中所有网格对象
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj

    if bpy.context.selected_objects:
        # 应用缩放
        bpy.ops.transform.resize(value=(scale_factor, scale_factor, scale_factor))
        # 应用变换
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def export_fbx(filepath):
    """导出为 FBX 格式，使用 UE5 兼容设置"""
    bpy.ops.export_scene.fbx(
        filepath=filepath,
        use_selection=False,
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Y",
        axis_up="Z",
        object_types={"MESH"},
        mesh_smooth_type="FACE",
        use_mesh_modifiers=True,
        use_mesh_modifiers_render=True,
        colors_type="SRGB",
        bake_anim=False,
        path_mode="COPY",
        embed_textures=True,
        batch_mode="OFF",
    )


def get_ue5_name(filename_without_ext):
    """根据映射表获取 UE5 资产名，如果没有映射则自动生成"""
    if filename_without_ext in ASSET_NAME_MAP:
        return ASSET_NAME_MAP[filename_without_ext]

    # 自动生成：将 camelCase 转为 PascalCase 并添加 SM_ 前缀
    name = filename_without_ext[0].upper() + filename_without_ext[1:]
    return f"SM_{name}_01"


def convert_file(input_path, output_dir, scale_factor):
    """转换单个 GLTF/GLB 文件为 FBX"""
    filename = os.path.basename(input_path)
    name_without_ext = os.path.splitext(filename)[0]
    ue5_name = get_ue5_name(name_without_ext)
    output_path = os.path.join(output_dir, f"{ue5_name}.fbx")

    print(f"  转换: {filename} → {ue5_name}.fbx")

    # 清空场景
    clear_scene()

    # 导入 GLTF
    import_gltf(input_path)

    # 应用缩放
    apply_scale(scale_factor)

    # 导出 FBX
    export_fbx(output_path)

    return ue5_name


def parse_args():
    """解析命令行参数（Blender 传递 -- 之后的参数）"""
    # 找到 -- 分隔符之后的参数
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description="批量将 GLTF/GLB 模型转换为 UE5 兼容的 FBX 格式"
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="GLTF/GLB 源文件目录路径"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="FBX 输出目录路径"
    )
    parser.add_argument(
        "--scale", "-s",
        type=float,
        default=100.0,
        help="缩放因子（默认 100，Three.js 米 → UE5 厘米）"
    )
    parser.add_argument(
        "--filter", "-f",
        default=None,
        help="可选，仅转换匹配的文件名（逗号分隔，如 'desk,chair'）"
    )

    return parser.parse_args(argv)


def main():
    args = parse_args()

    input_dir = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output)
    scale_factor = args.scale
    name_filter = None

    if args.filter:
        name_filter = [n.strip() for n in args.filter.split(",")]

    # 验证输入目录
    if not os.path.isdir(input_dir):
        print(f"错误: 输入目录不存在: {input_dir}")
        sys.exit(1)

    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)

    # 收集所有 GLB/GLTF 文件
    gltf_files = []
    for f in sorted(os.listdir(input_dir)):
        if f.lower().endswith((".glb", ".gltf")):
            name_without_ext = os.path.splitext(f)[0]
            if name_filter and not any(nf in name_without_ext for nf in name_filter):
                continue
            gltf_files.append(os.path.join(input_dir, f))

    if not gltf_files:
        print("未找到任何 GLTF/GLB 文件")
        sys.exit(1)

    print("=" * 60)
    print("WhyBuddy — GLTF → FBX 批量转换")
    print("=" * 60)
    print(f"  输入目录: {input_dir}")
    print(f"  输出目录: {output_dir}")
    print(f"  缩放因子: {scale_factor}x")
    print(f"  文件数量: {len(gltf_files)}")
    print("=" * 60)

    start_time = time.time()
    converted = []
    failed = []

    for i, filepath in enumerate(gltf_files, 1):
        filename = os.path.basename(filepath)
        print(f"\n[{i}/{len(gltf_files)}] 处理: {filename}")

        try:
            ue5_name = convert_file(filepath, output_dir, scale_factor)
            converted.append((filename, ue5_name))
        except Exception as e:
            print(f"  ❌ 转换失败: {e}")
            failed.append((filename, str(e)))

    elapsed = time.time() - start_time

    # 输出汇总报告
    print("\n" + "=" * 60)
    print("转换完成")
    print("=" * 60)
    print(f"  成功: {len(converted)}")
    print(f"  失败: {len(failed)}")
    print(f"  耗时: {elapsed:.1f} 秒")
    print(f"  输出: {output_dir}")

    if converted:
        print("\n成功转换的资产:")
        for src, dst in converted:
            print(f"  ✅ {src} → {dst}.fbx")

    if failed:
        print("\n转换失败的文件:")
        for src, err in failed:
            print(f"  ❌ {src}: {err}")

    # 生成导入清单文件
    manifest_path = os.path.join(output_dir, "import_manifest.txt")
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write("# WhyBuddy — FBX 导入清单\n")
        f.write(f"# 生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"# 缩放因子: {scale_factor}x\n")
        f.write(f"# 文件数量: {len(converted)}\n\n")
        f.write("# 格式: 源文件 → UE5 资产名\n")
        f.write("# 目标路径: Content/CubePets/Environment/Office/Meshes/\n\n")
        for src, dst in converted:
            f.write(f"{src} → {dst}.fbx\n")

    print(f"\n导入清单已保存: {manifest_path}")


if __name__ == "__main__":
    main()
