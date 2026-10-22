// src/ui/menu.js
// Menu terminal tiếng Việt, không icon.

import inquirer from 'inquirer';

export async function mainMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Chọn thao tác:',
      loop: false,
      pageSize: 18,
      choices: [
        new inquirer.Separator('--- Quest ---'),
        { name: '1. Xem danh sách quest', value: 'quest:list' },
        { name: '2. Nhận tất cả quest có sẵn', value: 'quest:accept' },
        { name: '3. Hoàn thành quest đang làm', value: 'quest:complete' },
        { name: '4. Nhận thưởng quest đã xong', value: 'quest:claim' },
        { name: '5. Xem video quest theo ID', value: 'quest:watch' },
        { name: '6. Full auto quest (nhận + làm + claim)', value: 'quest:full' },
        new inquirer.Separator('--- Badge ---'),
        { name: '7. Xem trạng thái badge', value: 'badge:status' },
        { name: '8. Farm Game Variety', value: 'badge:variety' },
        { name: '9. Farm Game Time', value: 'badge:time' },
        new inquirer.Separator('--- Dữ liệu ---'),
        { name: '10. Import thư viện Steam', value: 'data:steam' },
        { name: '11. Làm mới danh sách game detectable', value: 'data:games' },
        { name: '12. Kiểm tra môi trường (doctor)', value: 'data:doctor' },
        { name: '13. Cài đặt', value: 'settings' },
        new inquirer.Separator('---'),
        { name: '0. Thoát', value: 'exit' },
      ],
    },
  ]);

  return action;
}

export async function settingsMenu() {
  const { field } = await inquirer.prompt([
    {
      type: 'list',
      name: 'field',
      message: 'Cài đặt nào?',
      loop: false,
      choices: [
        { name: '1. Token Discord', value: 'token' },
        { name: '2. Poll interval (phút)', value: 'poll' },
        { name: '3. Thời gian giữ mỗi game (giây)', value: 'dwell' },
        { name: '4. Giới hạn game credit mỗi ngày', value: 'cap' },
        { name: '5. Nguồn game Steam', value: 'source' },
        { name: '6. Steam API key / SteamID64', value: 'steam' },
        { name: '7. Bật/tắt auto claim', value: 'claim' },
        { name: '0. Quay lại', value: 'back' },
      ],
    },
  ]);

  return field;
}

export async function askNumber(message, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const { value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
      default: String(defaultValue),
      validate: (input) => {
        const n = Number(input);
        if (!Number.isFinite(n)) return 'Nhập một số hợp lệ';
        if (n < min) return `Phải >= ${min}`;
        if (n > max) return `Phải <= ${max}`;
        return true;
      },
    },
  ]);

  return Number(value);
}

export async function askConfirm(message, defaultValue = false) {
  const { value } = await inquirer.prompt([
    { type: 'confirm', name: 'value', message, default: defaultValue },
  ]);
  return value;
}

export async function askText(message, defaultValue = '') {
  const { value } = await inquirer.prompt([
    { type: 'input', name: 'value', message, default: defaultValue },
  ]);
  return String(value).trim();
}
