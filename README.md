# Vạn Giới Ký

Game truyện tiên hiệp tương tác chạy hoàn toàn trên trình duyệt (GitHub Pages), người dẫn truyện là model chạy bằng Ollama trên máy người chơi. Không có bước build: `index.html` nạp thẳng các file `.js`.

## Lớp ngôn ngữ

Model nhỏ chạy local hay mắc lỗi tiếng Việt: bịa từ, viết tên bằng bính âm, đổi ngôi kể, lệch cặp xưng hô. Game xử lý ở ba tầng:

| Tầng | File | Việc làm |
| --- | --- | --- |
| Trước khi sinh | `narration-rules.js` | Toàn bộ luật kể chuyện (ngôi kể, xưng hô, Hán Việt, định dạng thẻ thoại, giao chiến, hảo cảm…), một **đoạn văn mẫu** để model bắt giọng, và bản sửa của người chơi làm ví dụ sai/đúng. Tham số lấy mẫu `NARRATION_SAMPLING` có `min_p` và `top_k` để cắt đuôi token rác, nguồn của phần lớn từ bịa. |
| Sau khi sinh | `vietnamese.js` + `fixVietnameseWords` trong `ai.js` | Sinh toàn bộ âm tiết tiếng Việt hợp lệ theo luật ngữ âm (~4.400 âm tiết không dấu thanh). Chữ viết thường không nằm trong tập này là chữ bịa; câu chứa nó được gửi lại cho model (temperature 0, JSON) để viết lại, chỉ nhận bản sửa ngắn gọn, không còn chữ lạ. Cùng cơ chế với `fixPinyinNames` đã có. |
| Người chơi dạy | `language-feedback.js` | Nhấp đôi vào đoạn truyện hoặc câu thoại để sửa. Bản sửa được (1) đưa vào system prompt các lượt sau, (2) ghi vào trí nhớ chương để prompt sau dùng câu đúng, (3) gom cùng toàn bộ lượt chơi để xuất JSONL fine-tune. |

### Ngữ cảnh (num_ctx) là điểm nghẽn

Đo trên Qwen3 14B: riêng system prompt tốn khoảng 5.400 token, phần truyện model phải viết thêm khoảng 3.000 token. Với `num_ctx` 8192, Ollama lặng lẽ cắt đầu prompt, tức là cắt đúng phần luật. Vì vậy:

- Mặc định là **12288**, chọn lại được trong Thiết lập (8192 / 12288 / 16384). Trên RTX 3060 12 GB, model 14B Q4 ở 12288 đẩy khoảng 7% sang CPU, tốc độ từ 35 xuống khoảng 26 token/giây.
- Muốn giữ 100% GPU ở 12288, đặt biến môi trường Windows rồi khởi động lại Ollama: `OLLAMA_FLASH_ATTENTION=1` và `OLLAMA_KV_CACHE_TYPE=q8_0` (KV cache nhỏ còn một nửa).
- `ai.js` ước lượng token trước mỗi lượt và rút gọn phần truyện gần đây, trí nhớ chương theo từng bậc cho tới khi prompt còn chỗ cho câu trả lời. Luật không bao giờ bị cắt.

## Đo chất lượng ngôn ngữ

`tools/eval-language.mjs` chạy các kịch bản trong `tools/scenarios.json` qua Ollama với đúng system prompt và tham số lấy mẫu của game, rồi chấm từng câu trả lời: từ không phải tiếng Việt, tên bính âm, chữ Hán, thoại ngoài thẻ, speaker không hợp lệ, tên người chơi hay đại từ sai trong lời dẫn, xưng hô lệch vai, câu lặp, tên minh họa lọt vào truyện, dòng chiến lợi phẩm sai chỗ, độ bao phủ hành động người chơi. Kết quả và văn bản gốc ghi vào `tools/eval-results/`.

```powershell
node tools/eval-language.mjs                               # 3 kịch bản, tham số của game
node tools/eval-language.mjs --runs 3 --label truoc-khi-doi # chạy lặp, đặt tên file kết quả
node tools/eval-language.mjs --no-exemplar                  # bỏ đoạn văn mẫu để đo tác dụng của nó
node tools/eval-language.mjs --baseline tools/eval-results/<file>.json   # in chênh lệch so với lần trước
```

Quy trình đổi luật: chạy một lần làm mốc, đổi `narration-rules.js`, chạy lại với `--baseline` và chỉ giữ thay đổi khi điểm phạt giảm. Thêm kịch bản mới vào `scenarios.json` khi gặp lỗi mà bộ hiện tại chưa bắt được.

## Dữ liệu huấn luyện và fine-tune

Nút **Xuất dữ liệu huấn luyện** trong Thiết lập tạo file `.jsonl`:

- Mỗi lượt chơi một dòng dạng `{"messages":[system, user, assistant]}`; phần `assistant` đã được thay bằng câu người chơi sửa nếu có.
- Các dòng `{"correction":{"before","after","by"}}` cho từng câu sửa, `by` là `player` (người chơi) hoặc `model` (máy tự sửa qua `fixVietnameseWords`).

Khi đã gom vài trăm lượt với bản sửa tay, có thể fine-tune LoRA bằng Unsloth hoặc LLaMA-Factory trên định dạng `messages` này (nên lọc chỉ lấy lượt có sửa hoặc điểm phạt thấp theo `eval-language.mjs`), xuất GGUF rồi nạp vào Ollama bằng `Modelfile` có dòng `FROM ./model.gguf`. Trên GPU 12 GB, QLoRA cho model 14B ở độ dài 8k token vượt bộ nhớ; thực tế hơn là fine-tune bản 8B hoặc chạy trên cloud, rồi vẫn dùng bộ luật và bộ lọc ở trên.

## Chạy

Mở `index.html` (hoặc trang GitHub Pages), chạy Ollama có model được ghi trong Thiết lập. Với GitHub Pages cần `OLLAMA_ORIGINS=https://duchx2404.github.io` để trình duyệt gọi được Ollama local.
