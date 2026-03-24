import React, { useState, useMemo } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Radio } from 'antd';

interface Transcription {
  id: string;
  createdAt: string;
  eventDate?: string;
  [key: string]: any;
}

interface CalendarPanelProps {
  onDateSelect: (date: string) => void;
  selectedDate?: string | null;
  dateType: 'created' | 'event';
  onDateTypeChange: (type: 'created' | 'event') => void;
  transcriptions: Transcription[];
}

const CalendarPanel: React.FC<CalendarPanelProps> = ({ 
  onDateSelect, 
  selectedDate, 
  dateType, 
  onDateTypeChange, 
  transcriptions 
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  // 获取当前月份信息
  const { year, month, firstDay, daysInMonth } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=周日
    const lastDay = new Date(year, month + 1, 0).getDate();
    return { year, month, firstDay, lastDay, daysInMonth: lastDay };
  }, [currentDate]);

  // 统计每天的记录数量
  const dateCountMap = useMemo(() => {
    const map: { [date: string]: number } = {};
    
    transcriptions.forEach((item) => {
      let dateStr: string;
      
      if (dateType === 'created') {
        dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
      } else {
        // 发生日期
        if (item.eventDate && item.eventDate !== '未提及') {
          try {
            const eventDate = new Date(item.eventDate.replace(/\//g, '-'));
            if (!isNaN(eventDate.getTime())) {
              dateStr = eventDate.toLocaleDateString('zh-CN');
            } else {
              dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
            }
          } catch {
            dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
          }
        } else {
          dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
        }
      }

      map[dateStr] = (map[dateStr] || 0) + 1;
    });
    
    return map;
  }, [transcriptions, dateType]);

  // 生成日历网格
  const calendarGrid = useMemo(() => {
    const grid: Array<{ day: number; date: string; isCurrentMonth: boolean; count: number }> = [];
    
    // 填充上个月的日期（占位）
    for (let i = 0; i < firstDay; i++) {
      grid.push({ day: 0, date: '', isCurrentMonth: false, count: 0 });
    }
    
    // 填充本月的日期
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toLocaleDateString('zh-CN');
      const count = dateCountMap[dateStr] || 0;
      grid.push({ day, date: dateStr, isCurrentMonth: true, count });
    }
    
    return grid;
  }, [year, month, firstDay, daysInMonth, dateCountMap]);

  // 切换月份
  const changeMonth = (offset: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + offset);
      return newDate;
    });
  };

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date().toLocaleDateString('zh-CN');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 280,
        background: 'var(--b3-theme-background, #fff)',
        borderRadius: 6,
        padding: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* 日期类型选择 */}
      <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Radio.Group
          value={dateType}
          onChange={(e) => onDateTypeChange(e.target.value)}
          size="small"
          style={{ fontSize: 12 }}
        >
          <Radio.Button value="created" style={{ fontSize: 11 }}>创建日期</Radio.Button>
          <Radio.Button value="event" style={{ fontSize: 11 }}>发生日期</Radio.Button>
        </Radio.Group>
      </div>

      {/* 月份导航 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: 12,
        fontSize: 14,
        fontWeight: 500,
      }}>
        <LeftOutlined 
          onClick={() => changeMonth(-1)}
          style={{ cursor: 'pointer', padding: 4, color: '#666' }}
        />
        <span>{year}年{month + 1}月</span>
        <RightOutlined 
          onClick={() => changeMonth(1)}
          style={{ cursor: 'pointer', padding: 4, color: '#666' }}
        />
      </div>

      {/* 星期标题 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(7, 1fr)',
        marginBottom: 4,
      }}>
        {weekDays.map(day => (
          <div 
            key={day}
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: '#999',
              padding: '4px 0',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日历网格 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 2,
      }}>
        {calendarGrid.map((cell, idx) => {
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;
          const dotCount = Math.min(cell.count, 3); // 最多显示3个点
          
          return (
            <div
              key={idx}
              onClick={() => cell.isCurrentMonth && cell.count > 0 && onDateSelect(cell.date)}
              style={{
                height: 32,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: cell.isCurrentMonth && cell.count > 0 ? 'pointer' : 'default',
                fontSize: 12,
                color: isToday ? '#1890ff' : isSelected ? '#fff' : '#333',
                fontWeight: isToday ? 500 : 400,
                background: isSelected ? '#1890ff' : 'transparent',
                borderRadius: 4,
                border: isToday && !isSelected ? '1px solid #1890ff' : 'none',
                position: 'relative',
              }}
            >
              {cell.isCurrentMonth && (
                <>
                  <div style={{ lineHeight: 1, height: 14 }}>{cell.day}</div>
                  {/* 数量数字 - 固定高度容器，确保布局一致 */}
                  <div style={{ 
                    fontSize: 7,
                    color: isSelected ? '#fff' : '#1890ff',
                    fontWeight: 500,
                    marginTop: 1,
                    lineHeight: 1,
                    height: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {cell.count > 0 ? cell.count : ''}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部提示 */}
      {selectedDate && (
        <div style={{ 
          marginTop: 12, 
          fontSize: 11, 
          color: '#999', 
          textAlign: 'center',
          paddingTop: 8,
          borderTop: '1px solid #f0f0f0',
        }}>
          已选择: {selectedDate}
        </div>
      )}
    </div>
  );
};

export default CalendarPanel;

