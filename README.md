# ImposterKim – v9 (Fixed Timer + Order)

## Kurulum
### Sunucu
```
cd server
npm i
npm run start
```
`.env` içeriği:
```
PORT=3001
ORIGIN=http://localhost:5173
MIN_PLAYERS=3
```

### İstemci
```
cd client
npm i
npm run dev
```

## Notlar
- Oda kurarken seçtiğin **Bekleme süresi** (örn. 20 sn) sunucuya gönderilir ve lobi kartında görünür.
- Oyun başında sıra **rastgele** belirlenir ve sabittir.
- **Sadece sıradaki** oyuncu yazabilir; diğerleri kilitlidir.
- Her konuşmacı değişiminde `turn_update` ile **Şimdi konuşan** ve **Kalan süre** güncellenir.
