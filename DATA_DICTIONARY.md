# 데이터 사전

## 관계

`clean_receipts.receipt_id` 1건에 `clean_lines.receipt_id` 여러 행이 연결됩니다. 상품 마스터는 `product_id`로 연결합니다. 원본 조회는 전표의 `source_file` 상대경로를 사용합니다. 작성자는 민승환, 학번은 2021308입니다.

## 전표 단위: clean_receipts

| 필드 | 형식 | 의미 |
|---|---|---|
| receipt_id | 문자열, 유일 | R001~R100 |
| date | YYYY-MM-DD | 한국시간 거래일 |
| time | HH:mm 또는 null | 기록된 거래 시각; 추정 보완하지 않음 |
| store | 문자열 | 카페 온담 |
| payment_method | 문자열 | 카드, 현금, 간편결제, 미확인 |
| line_count | 정수 | 전표 내 상품 데이터 행 수 |
| item_quantity | 정수 | 전표 내 수량 합계 |
| gross_amount | KRW 정수 | 할인 전 상품금액 합계 |
| discount | KRW 정수 | 품목별 할인 합계 |
| receipt_amount | KRW 정수 | 최종 전표 결제금액 |
| profile_id | 문자열 | 원본 형식 식별자 POS_A~POS_E |
| source_file | 상대경로 | receipts/Rxxx.pdf |
| cleaning_status | 문자열 | 정제완료 또는 정제완료_일부정보미확인 |
| issue_codes | 문자열 | MISSING_TIME / MISSING_PAYMENT; 복수는 세미콜론 구분 |

source_amount와 amount_difference는 엑셀의 검산용 열에만 있습니다.

## 상품 단위: clean_lines

| 필드 | 형식 | 의미 |
|---|---|---|
| line_id | 문자열, 유일 | 전표ID-L행번호 |
| receipt_id | 문자열 | 전표 외래키 |
| line_no | 정수 | 전표 안에서의 1부터 시작하는 순서 |
| product_id | 문자열 | 상품 마스터 외래키 |
| product_name | 문자열 | 표준 상품명 |
| category | 문자열 | 커피, 음료, 차, 베이커리, 디저트, 식사 |
| quantity | 정수 | 해당 상품 구매 수량 |
| unit_price | KRW 정수 | 부가세 포함 단가 |
| gross_amount | KRW 정수 | quantity × unit_price |
| discount | KRW 정수 | 이 행 전체의 할인금액; 단위당 할인이 아님 |
| line_amount | KRW 정수 | gross_amount - discount |

상품 행에는 날짜와 결제수단을 중복 저장하지 않았습니다. 전표에 조인해서 가져옵니다.

## 지표 계산

| 지표 | 계산 |
|---|---|
| 총매출 | 전표의 receipt_amount 합 또는 상품의 line_amount 합; 둘 중 하나만 사용 |
| 거래수 | 필터에 해당하는 receipt_id 고유 개수 |
| 평균 객단가 | 해당 범위 매출 ÷ 해당 범위 고유 전표 수 |
| 상품 매출 | product_id별 line_amount 합 |
| 상품 판매수량 | product_id별 quantity 합 |
| 카테고리 매출 | category별 line_amount 합 |
| 결제수단 사용률 | 해당 수단 전표 수 ÷ 전체 전표 수; 미확인도 분모에 포함 |
| 시간대별 매출 | time이 있는 전표만; 분석 대상 95/100건 표시 |
| 날짜별 매출 | date별 receipt_amount 합 |

상품·카테고리 필터에서는 해당 상품 행의 line_amount만 합하고 고유 전표 수로 나눕니다. 이 값은 ‘선택 상품 기준 거래당 매출’로 표기합니다. 그 전표의 다른 상품까지 포함한 전체 장바구니 객단가와 혼동하지 마세요. 거래가 없으면 0으로 나누지 말고 결과 없음으로 표시합니다.

원본 전표가 모두 정제되었다는 사실과 모든 항목이 완전하다는 사실은 다릅니다. 정제 완료 100건과 미확인 정보가 남은 전표 수를 구분하여 표시하세요.
