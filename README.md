# CAD Web Tools

Набор браузерных инструментов для работы с CAD-моделями и изображениями: аннотации, редактирование деталей 3D-моделей, режимы отображения STEP.

Все проекты работают полностью в браузере, без серверной обработки (кроме локальных dev-серверов).

## Инструменты

| Инструмент | Назначение | Стек |
|------------|-----------|------|
| [Annotation Editor](./annotation-editor) | Расстановка интерактивных сносок на изображении с автоматическим выравниванием | Vanilla JS, Canvas |
| [Model Editor](./model-editor) | Выделение деталей 3D-модели кликом и их перемещение в пространстве | Three.js, TransformControls |
| [STEP Display Modes](./step-display-modes) | Просмотр STEP-файлов в 5 режимах отображения (clay, wireframe, transparent и др.) | Three.js, occt-import-js |

## Структура

```
cad-web-tools/
├── annotation-editor/     # Редактор 2D сносок
├── model-editor/          # Редактор 3D деталей (GLB/GLTF)
├── step-display-modes/    # Просмотр STEP с режимами
└── README.md
```

## Запуск

Каждый проект запускается отдельно:

```bash
cd annotation-editor    # или model-editor, step-display-modes
npx serve .
```

Открой http://localhost:3000

Для `model-editor` можно использовать встроенный сервер:

```bash
cd model-editor
node server.js
```

Для `step-display-modes` — обязательно через HTTP-сервер (ES-модули и WASM не работают через `file://`).

## Общие технологии

- Three.js
- WebGL 2.0
- ES6 modules
- OpenCascade (WASM) для работы с STEP
- Vanilla JavaScript, без тяжёлых фреймворков

## Лицензия

MIT