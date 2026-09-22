#!/bin/sh
# 图库可达性探针 —— 在**生产服务器上**跑（国内那台）。
# 只用 curl，不装任何东西。每个域名量三次取最好的一次。
#
#   sh stock-probe.sh
#
# 关注两列：
#   code  —— 000 = 连不上（DNS/TLS/超时），其它数字都算通
#   time  —— 秒。>3s 基本等于不能用在同步链路里

probe() {
  name=$1; url=$2
  best=""; code=""
  i=0
  while [ $i -lt 3 ]; do
    out=$(curl -s -o /dev/null -m 10 -w "%{http_code} %{time_total}" "$url" 2>/dev/null)
    c=$(echo "$out" | cut -d' ' -f1); t=$(echo "$out" | cut -d' ' -f2)
    if [ -z "$best" ] || [ "$(echo "$t < $best" | bc 2>/dev/null || echo 0)" = "1" ]; then
      best=$t; code=$c
    fi
    i=$((i+1))
  done
  printf '%-26s %-6s %ss\n' "$name" "$code" "$best"
}

echo "=== 图库 API ==="
probe "unsplash api"    "https://api.unsplash.com/"
probe "pexels api"      "https://api.pexels.com/"
probe "pixabay api"     "https://pixabay.com/api/"
probe "openverse api"   "https://api.openverse.org/v1/images/?q=test&page_size=1"

echo
echo "=== 图片 CDN（真正要下大图的地方，比 API 更要紧）==="
probe "unsplash cdn"    "https://images.unsplash.com/"
probe "pexels cdn"      "https://images.pexels.com/"
probe "pixabay cdn"     "https://cdn.pixabay.com/"
probe "rawpixel cdn"    "https://images.rawpixel.com/"
probe "wikimedia upload" "https://upload.wikimedia.org/"

echo
echo "=== 真下一张大图（525KB，量实际吞吐）==="
url="https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTExL2ZsNTE2Njg0OTMwNjQtaW1hZ2UuanBn.jpg"
curl -s -o /tmp/_probe.jpg -m 60 -w "  HTTP %{http_code}  %{size_download} 字节  %{time_total}s  %{speed_download} B/s\n" "$url"
rm -f /tmp/_probe.jpg
